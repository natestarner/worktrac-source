import Foundation
import Capacitor
import StoreKit

/// In-App Purchase on StoreKit 2 -- the iOS half of `lib/native/purchases.js`, which is the only place
/// the app talks to a store. Android gets its own plugin with the same calls; nothing above them
/// changes (docs/in-app-purchase-plan.md).
///
/// What this deliberately does NOT do: decide anything. It never unlocks a plan and never says
/// whether a purchase "worked" beyond StoreKit's answer. It hands the transaction's signed JWS to the
/// app, the app sends it to our backend, the backend verifies it with Apple and writes the plan, and
/// only THEN does the app call `finish`. Until a transaction is finished StoreKit keeps handing it
/// back (`unfinished`, and `Transaction.updates` on the next launch), which is the retry mechanism if
/// our backend is down or the app dies mid-purchase: the store's own queue, not a second outbox.
///
/// Every transaction is reported with:
///   `proof`          the transaction's signed JWS (`jwsRepresentation`), what the backend verifies
///   `transactionId`  the id to `finish` it by, as a string (a UInt64 does not survive JavaScript)
@objc(PurchasesPlugin)
public class PurchasesPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PurchasesPlugin"
    public let jsName = "Purchases"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getProducts", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "purchase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restore", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "unfinished", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "currentSubscription", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "finish", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "manageSubscriptions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestRefund", returnType: CAPPluginReturnPromise)
    ]

    private let held = HeldTransactions()
    private var updatesTask: Task<Void, Never>?
    private var intentsTask: Task<Void, Never>?

    /// Starts listening as soon as the plugin loads, as Apple asks: renewals, Ask to Buy approvals and
    /// purchases made on another device arrive here, often while no purchase screen is open. Events are
    /// retained until the app's listener is attached, so one that lands during launch is not lost.
    override public func load() {
        updatesTask = Task.detached { [weak self] in
            for await result in Transaction.updates {
                guard let self = self else { return }
                let reported = await self.held.hold(result)
                self.notifyListeners("transaction", data: reported.asDictionary(), retainUntilConsumed: true)
            }
        }
        // Purchases started OUTSIDE the app -- "subscribe" on Huddle's App Store page -- arrive here
        // (iOS 16.4+). Apple: the purchase is completed in the app. The app takes the person to Plan &
        // billing and buys through its own flow, so the purchase carries the household token; this is
        // what lets Streamlined Purchasing be turned off in App Store Connect. Retained until the app's
        // listener attaches, which happens only once someone is signed in.
        if #available(iOS 16.4, *) {
            intentsTask = Task.detached { [weak self] in
                for await intent in PurchaseIntent.intents {
                    guard let self = self else { return }
                    self.notifyListeners("purchaseIntent", data: ["productId": intent.product.id],
                                         retainUntilConsumed: true)
                }
            }
        }
    }

    deinit {
        updatesTask?.cancel()
        intentsTask?.cancel()
    }

    /// `{ productIds: [String] }` -> `{ products: [{ id, displayName, displayPrice, periodUnit, periodValue }] }`.
    /// `displayPrice` is the store's own localized price string; the app shows it as is and never
    /// holds a price of its own. A product App Store Connect doesn't know is simply absent.
    @objc func getProducts(_ call: CAPPluginCall) {
        let ids = call.getArray("productIds", String.self) ?? []
        Task {
            do {
                let products = try await Product.products(for: ids)
                call.resolve(["products": products.map(PurchasesPlugin.describe)])
            } catch {
                call.reject("Could not load products from the App Store", "PRODUCTS_UNAVAILABLE", error)
            }
        }
    }

    /// `{ productId, accountToken }` -> `{ result: "purchased", proof, transactionId }`,
    /// `{ result: "pending" }` (Ask to Buy, or a bank's approval; it arrives later through the
    /// `transaction` listener) or `{ result: "cancelled" }`.
    ///
    /// `accountToken` is the household's token from our backend's prepare, a UUID. Apple signs it into
    /// the transaction and every renewal, which is how the backend finds the household later without
    /// trusting whoever is signed in. A purchase is refused here without one.
    @objc func purchase(_ call: CAPPluginCall) {
        guard let productId = call.getString("productId"),
              let tokenString = call.getString("accountToken"),
              let token = UUID(uuidString: tokenString) else {
            call.reject("productId and accountToken are required", "BAD_REQUEST")
            return
        }
        Task {
            do {
                guard let product = try await Product.products(for: [productId]).first else {
                    call.reject("The App Store doesn't know this product", "UNKNOWN_PRODUCT")
                    return
                }
                let result = try await PurchasesPlugin.purchase(product, token: token, from: self.bridge?.viewController)
                switch result {
                case .success(let verification):
                    let reported = await self.held.hold(verification)
                    var data = reported.asDictionary()
                    data["result"] = "purchased"
                    call.resolve(data)
                case .pending:
                    call.resolve(["result": "pending"])
                case .userCancelled:
                    call.resolve(["result": "cancelled"])
                @unknown default:
                    call.resolve(["result": "cancelled"])
                }
            } catch {
                call.reject(error.localizedDescription, "PURCHASE_FAILED", error)
            }
        }
    }

    /// Restore Purchases: asks the App Store to sync (which may ask the person to sign in), then
    /// reports every subscription this Apple ID currently holds -> `{ proofs: [{ proof, transactionId }] }`.
    /// A declined or failed sign-in still reports what the device already knows.
    @objc func restore(_ call: CAPPluginCall) {
        Task {
            try? await AppStore.sync()
            var proofs: [[String: Any]] = []
            for await result in Transaction.currentEntitlements {
                let reported = await self.held.hold(result)
                proofs.append(reported.asDictionary())
            }
            call.resolve(["proofs": proofs])
        }
    }

    /// The subscription this Apple ID holds right now, read from what the device already knows (no
    /// `AppStore.sync()`, so never a sign-in prompt) -> `{ held: false }` or
    /// `{ held: true, productId, accountToken }`, where `accountToken` is the household token signed
    /// into it (lowercased), or null for a purchase that named none. A subscription belongs to the
    /// Apple ID, one per group, so Apple answers "already subscribed" when a second household on the
    /// same Apple ID tries to buy; this is how the app can say WHICH household it belongs to.
    @objc func currentSubscription(_ call: CAPPluginCall) {
        Task {
            for await result in Transaction.currentEntitlements {
                let transaction = PurchasesPlugin.transaction(of: result)
                if transaction.productType == .autoRenewable {
                    let token: Any = transaction.appAccountToken.map { $0.uuidString.lowercased() } ?? NSNull()
                    call.resolve(["held": true, "productId": transaction.productID, "accountToken": token])
                    return
                }
            }
            call.resolve(["held": false])
        }
    }

    /// Every transaction not yet finished -> `{ proofs: [...] }`: what the app sends to the backend on
    /// launch and on sign-in, so a purchase whose confirmation never reached us is applied after all.
    @objc func unfinished(_ call: CAPPluginCall) {
        Task {
            var proofs: [[String: Any]] = []
            for await result in Transaction.unfinished {
                let reported = await self.held.hold(result)
                proofs.append(reported.asDictionary())
            }
            call.resolve(["proofs": proofs])
        }
    }

    /// `{ transactionId }`: tells StoreKit this transaction is handled. Only ever called after our
    /// backend answered 2xx for it. Finishing one that is already finished, or unknown, is a no-op.
    @objc func finish(_ call: CAPPluginCall) {
        guard let idString = call.getString("transactionId"), let id = UInt64(idString) else {
            call.reject("transactionId is required", "BAD_REQUEST")
            return
        }
        Task {
            if let transaction = await self.held.take(id) {
                await transaction.finish()
            } else {
                for await result in Transaction.unfinished {
                    let transaction = PurchasesPlugin.transaction(of: result)
                    if transaction.id == id {
                        await transaction.finish()
                        break
                    }
                }
            }
            call.resolve()
        }
    }

    /// Apple's own manage-subscription sheet: change plan within the group, switch monthly/yearly,
    /// or cancel. The app never offers any of those itself for an App Store household.
    ///
    /// Resolves `{ result: "shown" }`, or `{ result: "unavailable" }` for the iPad app running on a Mac,
    /// where Apple says to avoid this sheet ("if isiOSAppOnMac is true, avoid showing the user
    /// interface for this feature"); the app then says where to manage it instead.
    @objc func manageSubscriptions(_ call: CAPPluginCall) {
        if ProcessInfo.processInfo.isiOSAppOnMac {
            call.resolve(["result": "unavailable"])
            return
        }
        Task { @MainActor in
            guard let scene = self.bridge?.viewController?.view.window?.windowScene else {
                call.reject("No window to show the App Store sheet in", "NO_WINDOW")
                return
            }
            do {
                try await AppStore.showManageSubscriptions(in: scene)
                call.resolve(["result": "shown"])
            } catch {
                call.reject(error.localizedDescription, "MANAGE_FAILED", error)
            }
        }
    }

    /// Apple's own refund-request sheet for this Apple ID's current subscription ->
    /// `{ result: "requested" }`, `{ result: "cancelled" }`, or `{ result: "none" }` when this Apple ID
    /// holds no subscription here (it was bought on another Apple ID, or on the web). Apple decides
    /// and emails the person; a granted refund reaches our backend as a REVOKED notification.
    @objc func requestRefund(_ call: CAPPluginCall) {
        Task { @MainActor in
            var current: Transaction?
            for await result in Transaction.currentEntitlements {
                let transaction = PurchasesPlugin.transaction(of: result)
                if transaction.productType == .autoRenewable {
                    current = transaction
                    break
                }
            }
            guard let transaction = current else {
                call.resolve(["result": "none"])
                return
            }
            guard let scene = self.bridge?.viewController?.view.window?.windowScene else {
                call.reject("No window to show the App Store sheet in", "NO_WINDOW")
                return
            }
            do {
                let status = try await Transaction.beginRefundRequest(for: transaction.id, in: scene)
                switch status {
                case .success:
                    call.resolve(["result": "requested"])
                case .userCancelled:
                    call.resolve(["result": "cancelled"])
                @unknown default:
                    call.resolve(["result": "cancelled"])
                }
            } catch {
                call.reject(error.localizedDescription, "REFUND_FAILED", error)
            }
        }
    }

    // MARK: - helpers

    /// Apple: "Use purchase(confirmIn:options:) for apps that use UIKit" -- which a Capacitor app is --
    /// so the confirmation sheet is tied to the app's own window scene (iOS 17+). iOS 15 and 16 have
    /// only purchase(options:). Both carry the household token.
    @MainActor
    static func purchase(_ product: Product, token: UUID, from viewController: UIViewController?) async throws
        -> Product.PurchaseResult {
        let options: Set<Product.PurchaseOption> = [.appAccountToken(token)]
        if #available(iOS 17.0, *), let scene = viewController?.view.window?.windowScene {
            return try await product.purchase(confirmIn: scene, options: options)
        }
        return try await product.purchase(options: options)
    }

    /// StoreKit's own on-device check is NOT the authority -- our backend verifies the JWS with Apple
    /// -- so an unverified transaction is still reported, and the backend refuses it if it is bad.
    static func transaction(of result: VerificationResult<Transaction>) -> Transaction {
        switch result {
        case .verified(let transaction):
            return transaction
        case .unverified(let transaction, _):
            return transaction
        }
    }

    static func describe(_ product: Product) -> [String: Any] {
        var item: [String: Any] = [
            "id": product.id,
            "displayName": product.displayName,
            "displayPrice": product.displayPrice
        ]
        if let period = product.subscription?.subscriptionPeriod {
            item["periodValue"] = period.value
            switch period.unit {
            case .day: item["periodUnit"] = "DAY"
            case .week: item["periodUnit"] = "WEEK"
            case .month: item["periodUnit"] = "MONTH"
            case .year: item["periodUnit"] = "YEAR"
            @unknown default: item["periodUnit"] = "UNKNOWN"
            }
        }
        return item
    }
}

/// What one transaction is reported as: plain strings, so it crosses from the actor below to the
/// plugin without sharing anything mutable.
struct ReportedTransaction: Sendable {
    let proof: String
    let transactionId: String
    let productId: String

    func asDictionary() -> [String: Any] {
        ["proof": proof, "transactionId": transactionId, "productId": productId]
    }
}

/// Transactions the app has been told about but has not finished yet, so `finish` can finish the
/// exact object StoreKit handed over without searching `Transaction.unfinished` each time.
actor HeldTransactions {
    private var byId: [UInt64: Transaction] = [:]

    func hold(_ result: VerificationResult<Transaction>) -> ReportedTransaction {
        let transaction = PurchasesPlugin.transaction(of: result)
        byId[transaction.id] = transaction
        return ReportedTransaction(proof: result.jwsRepresentation,
                                   transactionId: String(transaction.id),
                                   productId: transaction.productID)
    }

    func take(_ id: UInt64) -> Transaction? {
        byId.removeValue(forKey: id)
    }
}
