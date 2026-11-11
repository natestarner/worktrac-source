package com.worktrac.backend.identity;

import com.worktrac.backend.common.ConflictException;
import com.worktrac.backend.common.ForbiddenException;
import com.worktrac.backend.common.NotFoundException;
import com.worktrac.backend.common.ServiceUnavailableException;
import com.worktrac.backend.common.TooManyRequestsException;
import com.worktrac.backend.common.UnauthorizedException;
import com.worktrac.backend.config.AdminProperties;
import com.worktrac.backend.identity.dto.ConnectIdentityRequest;
import com.worktrac.backend.identity.dto.SignInMethodsResponse;
import com.worktrac.backend.identity.dto.SocialSignInRequest;
import com.worktrac.backend.membership.AccountAccessService;
import com.worktrac.backend.ratelimit.LoginRateLimiter;
import com.worktrac.backend.user.AuthService;
import com.worktrac.backend.user.RegistrationService;
import com.worktrac.backend.user.User;
import com.worktrac.backend.user.UserRepository;
import com.worktrac.backend.user.dto.AuthResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;

/**
 * Sign in, sign up, connect and disconnect with Apple or Google. Design and the reasoning behind
 * every rule here: docs/architecture/social-sign-in.md.
 *
 * <p><b>The one rule everything else serves: a provider identity is matched by its stable
 * subject, and an email a provider asserts is NEVER enough to reach an existing login.</b> An
 * unlinked identity whose email already belongs to a Huddle login is refused with "sign in with
 * your password, then connect it in Profile". Linking on a matching email would hand that
 * household to whoever controls the Google account, including a Google account carrying an old
 * work address that has since changed hands. {@code SocialSignInTest} pins it, and asserts no
 * identity row is written.
 *
 * <p><b>Admin logins never sign in this way</b>, and an ADMIN_EMAILS address can never be signed
 * UP this way (that would mint an admin from a provider's say-so).
 *
 * <p><b>Status codes follow the house rules.</b> The sign-in route is permitAll and carries no
 * session, so a token that proves nothing is a 401, exactly like a wrong password at /login. The
 * connect/disconnect routes run on a session, so a bad provider token there is a 403 -- a 401
 * would sign the person out over a second credential (backend-core.md).
 */
@Service
public class SocialSignInService {

    private static final Logger log = LoggerFactory.getLogger(SocialSignInService.class);

    /** The client answers this by asking for a name, then sending the same token again. */
    public static final String SIGN_UP_REQUIRED = "SIGN_UP_REQUIRED";

    private final IdTokenVerifier verifier;
    private final UserIdentityRepository identityRepository;
    private final UserRepository userRepository;
    private final AuthService authService;
    private final RegistrationService registrationService;
    private final AdminProperties adminProperties;
    private final LoginRateLimiter loginRateLimiter;
    private final AccountAccessService accountAccessService;
    private final Clock clock;

    public SocialSignInService(IdTokenVerifier verifier, UserIdentityRepository identityRepository,
                               UserRepository userRepository, AuthService authService,
                               RegistrationService registrationService, AdminProperties adminProperties,
                               LoginRateLimiter loginRateLimiter, AccountAccessService accountAccessService,
                               Clock clock) {
        this.verifier = verifier;
        this.identityRepository = identityRepository;
        this.userRepository = userRepository;
        this.authService = authService;
        this.registrationService = registrationService;
        this.adminProperties = adminProperties;
        this.loginRateLimiter = loginRateLimiter;
        this.accountAccessService = accountAccessService;
        this.clock = clock;
    }

    /**
     * {@code POST /api/auth/oauth/{provider}}. Answers with the same two {@link AuthResponse}
     * shapes {@code /login} does -- a session, or the household picker -- or 409
     * {@link #SIGN_UP_REQUIRED} when this is a new person who has not given a name yet.
     */
    @Transactional
    public AuthResponse signIn(String providerPath, SocialSignInRequest request, String ipAddress) {
        IdentityProvider provider = requireAvailable(providerPath);

        // BEFORE verifying: verification can make a network call (a JWKS refresh for an unseen key
        // id), so an unthrottled flood of junk tokens would be a way to make us hammer Google.
        // The login buckets, because this IS a login -- one attacker shares one allowance across
        // both doors rather than getting a fresh one at each.
        if (!loginRateLimiter.tryConsumePerIp(ipAddress)) {
            log.warn("{} sign-in blocked by per-IP rate limit from ip {}", provider, ipAddress);
            throw new TooManyRequestsException("Too many sign-in attempts from this address -- please try again later.");
        }
        if (!loginRateLimiter.tryConsumeGlobal()) {
            log.warn("{} sign-in blocked by global rate limit (ip {})", provider, ipAddress);
            throw new TooManyRequestsException("We're seeing a lot of sign-in attempts right now -- please try again shortly.");
        }

        VerifiedIdentity identity = verifyForSignIn(provider, request.idToken(), request.nonce(), ipAddress);

        Optional<UserIdentity> linked = identityRepository.findByProviderAndSubject(provider, identity.subject());
        if (linked.isPresent()) {
            User user = linked.get().getUser();
            refuseAdmin(user.getEmail(), provider, "sign-in");
            linked.get().markUsed(clock.instant());
            log.info("{} sign-in for user {} from ip {}", provider, user.getId(), ipAddress);
            return authService.completeVerifiedSignIn(user);
        }

        return signUp(provider, identity, request, ipAddress);
    }

    private AuthResponse signUp(IdentityProvider provider, VerifiedIdentity identity,
                                SocialSignInRequest request, String ipAddress) {
        String email = identity.email();
        if (email == null || !identity.emailVerified()) {
            log.warn("{} sign-up refused from ip {}: no verified email on the token", provider, ipAddress);
            throw new ForbiddenException("We couldn't get a verified email address from " + provider.displayName()
                    + ". Create your Huddle login with an email and password instead.");
        }

        refuseAdmin(email, provider, "sign-up");

        // ⚠️ THE RULE. See the class comment. Not a takeover path, and not an enumeration oracle
        // either: the caller has just proved to the provider that this address is theirs.
        if (userRepository.existsByEmail(email)) {
            log.info("{} sign-in from ip {} matched an existing login by email; refused, not linked", provider, ipAddress);
            throw new ConflictException("You already have a Huddle login for this email. Sign in with your password,"
                    + " then connect " + provider.displayName() + " in Profile.");
        }

        if (request.personName() == null || request.personName().isBlank()) {
            throw new ConflictException("Tell us your name to finish creating your Huddle login.", SIGN_UP_REQUIRED);
        }

        AuthResponse response = registrationService.createSocialLogin(
                email, request.personName(), request.accountName(), provider.displayName(), ipAddress);
        User user = userRepository.findById(response.user().id())
                .orElseThrow(() -> new IllegalStateException("The login just created is missing"));
        identityRepository.save(new UserIdentity(user, provider, identity.subject(), email, clock.instant()));
        return response;
    }

    /** {@code GET /api/user/sign-in-methods}. */
    @Transactional(readOnly = true)
    public SignInMethodsResponse methods(Long userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UnauthorizedException("That login is no longer active."));
        List<SignInMethodsResponse.Connected> connected = identityRepository
                .findByUser_IdOrderByCreatedAtAscIdAsc(userId).stream()
                .map(i -> new SignInMethodsResponse.Connected(i.getProvider().path(), i.getCreatedAt(), i.getLastUsedAt()))
                .toList();
        // An admin is offered nothing to connect: connecting would be refused (refuseAdmin), and a
        // control the server will refuse must not be offered.
        List<String> available = adminProperties.isAdminEmail(user.getEmail())
                ? List.of()
                : Arrays.stream(IdentityProvider.values())
                        .filter(verifier::isAvailable)
                        .map(IdentityProvider::path)
                        .toList();
        return new SignInMethodsResponse(user.hasPassword(), connected, available);
    }

    /**
     * {@code POST /api/user/sign-in-methods/{provider}}: connect an Apple or Google account to the
     * signed-in login. Idempotent: connecting the same identity twice is a success.
     */
    @Transactional
    public SignInMethodsResponse connect(Long userId, String providerPath, ConnectIdentityRequest request) {
        IdentityProvider provider = requireAvailable(providerPath);
        User user = userRepository.findByIdForUpdate(userId)
                .orElseThrow(() -> new UnauthorizedException("That login is no longer active."));
        refuseAdmin(user.getEmail(), provider, "connect");

        VerifiedIdentity identity;
        try {
            identity = verifier.verify(provider, request.idToken(), request.nonce());
        } catch (InvalidIdTokenException e) {
            log.warn("{} connect refused for user {}: {}", provider, userId, e.getMessage());
            // 403, not 401: the SESSION is fine. See the class comment.
            throw new ForbiddenException("We couldn't confirm that " + provider.displayName() + " sign-in. Please try again.");
        } catch (ProviderUnreachableException e) {
            log.warn("{} connect for user {} could not reach the provider: {}", provider, userId, e.getMessage());
            throw unreachable(provider);
        }

        Optional<UserIdentity> existing = identityRepository.findByProviderAndSubject(provider, identity.subject());
        if (existing.isPresent()) {
            if (existing.get().getUser().getId().equals(userId)) {
                return methods(userId);
            }
            log.warn("{} connect refused for user {}: identity already belongs to user {}",
                    provider, userId, existing.get().getUser().getId());
            throw new ConflictException("That " + provider.displayName()
                    + " account is already connected to a different Huddle login.");
        }
        if (identityRepository.findByUser_IdAndProvider(userId, provider).isPresent()) {
            throw new ConflictException("This login is already connected to a different " + provider.displayName()
                    + " account. Disconnect that one first.");
        }

        identityRepository.save(new UserIdentity(user, provider, identity.subject(), identity.email(), clock.instant()));
        log.info("{} connected to user {}", provider, userId);
        return methods(userId);
    }

    /**
     * {@code DELETE /api/user/sign-in-methods/{provider}}. Returns a REPLACEMENT SESSION, like a
     * password change, because it bumps {@code token_version}: the usual reason to disconnect a
     * Google account is believing it was compromised, and that must sign out every session it
     * could have opened. The caller swaps the returned token in.
     *
     * <p>Allowed whether or not sign-in with this provider is switched on here -- somebody must
     * always be able to remove a way into their own login.
     */
    @Transactional
    public AuthResponse disconnect(Long userId, Long accountId, String providerPath) {
        IdentityProvider provider = IdentityProvider.fromPath(providerPath)
                .orElseThrow(() -> new NotFoundException("Not found"));
        User user = userRepository.findByIdForUpdate(userId)
                .orElseThrow(() -> new UnauthorizedException("That login is no longer active."));
        UserIdentity identity = identityRepository.findByUser_IdAndProvider(userId, provider)
                .orElseThrow(() -> new NotFoundException(provider.displayName() + " isn't connected to this login."));

        // Never leave a login with no way in. The count includes the identity about to go.
        if (!user.hasPassword() && identityRepository.countByUser_Id(userId) <= 1) {
            throw new ConflictException("This is the only way you sign in. Set a password or connect another"
                    + " sign-in method first.");
        }

        identityRepository.delete(identity);
        user.bumpTokenVersion();
        userRepository.save(user);
        accountAccessService.invalidateUser(userId);
        log.info("{} disconnected from user {}", provider, userId);
        // The version just MINTED -- see PasswordChangeService.changePassword for why.
        return authService.startSession(userId, user.getTokenVersion(), accountId);
    }

    private VerifiedIdentity verifyForSignIn(IdentityProvider provider, String idToken, String nonce, String ipAddress) {
        try {
            return verifier.verify(provider, idToken, nonce);
        } catch (InvalidIdTokenException e) {
            // The reason goes to OUR log only. The caller learns nothing about which check failed.
            log.warn("{} sign-in refused from ip {}: {}", provider, ipAddress, e.getMessage());
            throw new UnauthorizedException("We couldn't confirm that " + provider.displayName()
                    + " sign-in. Please try again.");
        } catch (ProviderUnreachableException e) {
            log.warn("{} sign-in from ip {} could not reach the provider: {}", provider, ipAddress, e.getMessage());
            throw unreachable(provider);
        }
    }

    private IdentityProvider requireAvailable(String providerPath) {
        // An unknown provider and a switched-off one answer identically: nothing here should tell
        // a caller how this environment is configured.
        return IdentityProvider.fromPath(providerPath)
                .filter(verifier::isAvailable)
                .orElseThrow(() -> new NotFoundException("Not found"));
    }

    private void refuseAdmin(String email, IdentityProvider provider, String action) {
        if (adminProperties.isAdminEmail(email)) {
            log.warn("{} {} refused: admin logins use a password", provider, action);
            throw new ForbiddenException("Admin logins sign in with a password.");
        }
    }

    private static ServiceUnavailableException unreachable(IdentityProvider provider) {
        return new ServiceUnavailableException("We couldn't reach " + provider.displayName()
                + " to confirm your sign-in. Try again in a moment.");
    }
}
