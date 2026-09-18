package com.worktrac.backend.admin;

import com.worktrac.backend.billing.CompGrantService;
import com.worktrac.backend.security.CurrentUser;
import org.springframework.boot.health.actuate.endpoint.HealthEndpoint;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Clock;
import java.util.List;

// Every route here is gated by SecurityConfig (/api/admin/** -> hasRole('ADMIN')), so
// unlike every other controller in the app it deliberately does NOT scope by
// CurrentUser.accountId() -- that's the entire point of this controller.
//
// That gate is route-level rather than per-method, and it is NOT merely a claim on the token:
// JwtAuthenticationFilter re-checks the caller's email against ADMIN_EMAILS on every single
// request and can only ever demote. So a route added here inherits the full gate automatically --
// and, just as importantly, a route added to a NEW controller class does not inherit
// HandlerPermissionCoverageTest's exemption and will fail the build until it is listed there.
// Keep admin routes on this class unless there is a reason (like TestDataAdminController's
// @Profile gating) to do otherwise.
@RestController
@RequestMapping("/api/admin")
public class AdminController {

    private final AdminService adminService;
    private final HealthEndpoint healthEndpoint;
    private final CompGrantService compGrantService;
    private final CurrentUser currentUser;
    private final Clock clock;

    public AdminController(AdminService adminService, HealthEndpoint healthEndpoint,
                            CompGrantService compGrantService, CurrentUser currentUser, Clock clock) {
        this.adminService = adminService;
        this.healthEndpoint = healthEndpoint;
        this.compGrantService = compGrantService;
        this.currentUser = currentUser;
        this.clock = clock;
    }

    @GetMapping("/overview")
    public AdminOverviewDto overview() {
        return adminService.overview();
    }

    @GetMapping("/accounts")
    public List<AdminAccountDto> accounts() {
        return adminService.listAccounts();
    }

    @GetMapping("/people")
    public List<AdminPersonDto> people() {
        return adminService.listPeople();
    }

    @GetMapping("/pending-registrations")
    public List<AdminPendingRegistrationDto> pendingRegistrations() {
        return adminService.listPendingRegistrations();
    }

    @GetMapping("/registration-events")
    public List<AdminRegistrationEventDto> registrationEvents() {
        return adminService.listRegistrationEvents();
    }

    // The one mutating admin endpoint -- a narrow, sanctioned exception to the read-only
    // invariant everywhere else in this controller (see class comment): this is alerting
    // *configuration*, not application data.
    @GetMapping("/registration-alert-settings")
    public AdminRegistrationAlertSettingsDto registrationAlertSettings() {
        return adminService.getRegistrationAlertSettings();
    }

    @PutMapping("/registration-alert-settings")
    public AdminRegistrationAlertSettingsDto updateRegistrationAlertSettings(
            @RequestBody AdminRegistrationAlertSettingsDto request) {
        return adminService.updateRegistrationAlertSettings(request);
    }

    @GetMapping("/contact-messages")
    public List<AdminContactMessageDto> contactMessages() {
        return adminService.contactMessages();
    }

    @GetMapping("/health")
    public AdminHealthDto health() {
        String status = healthEndpoint.health().getStatus().getCode();
        return new AdminHealthDto(status, clock.instant());
    }

    // SANCTIONED WRITE EXCEPTION #3 -- granting and removing a comp. See
    // .claude/rules/admin-portal.md for the sign-off and docs/architecture/billing.md for why this
    // replaced COMPED_EMAILS (which made handing somebody a free plan a deploy).
    //
    // ⚠️ THE ACTING ADMIN COMES FROM THE SECURITY CONTEXT, NEVER FROM THE BODY. currentUser.get()
    // returns a principal JwtAuthenticationFilter already validated in full -- signature, expiry,
    // no scp claim, token version against the live user row, and a membership that still exists --
    // and whose ADMIN authority was re-checked against ADMIN_EMAILS on this very request. An
    // actorEmail field on AdminCompRequest would let a caller write anybody's name into the audit
    // trail, which is the one thing that would make the trail worthless.
    //
    // 204 rather than the updated row: rebuilding one AdminAccountDto means re-running every
    // aggregate listAccounts() computes, and the client already refetches (the same shape the
    // alert-settings panel uses).
    @PostMapping("/accounts/{accountId}/comp")
    public ResponseEntity<Void> grantComp(@PathVariable Long accountId,
                                           @RequestBody AdminCompRequest request) {
        compGrantService.grant(accountId, request.plan(), request.band(), request.note(),
                currentUser.get().email());
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping("/accounts/{accountId}/comp")
    public ResponseEntity<Void> revokeComp(@PathVariable Long accountId) {
        compGrantService.revoke(accountId, currentUser.get().email());
        return ResponseEntity.noContent().build();
    }
}
