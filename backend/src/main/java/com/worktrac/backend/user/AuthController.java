package com.worktrac.backend.user;

import com.worktrac.backend.common.UnauthorizedException;
import com.worktrac.backend.security.AccountPrincipal;
import com.worktrac.backend.security.ClientIpResolver;
import com.worktrac.backend.security.CurrentUser;

import com.worktrac.backend.membership.MembershipInviteService;
import com.worktrac.backend.security.TokenAuthenticator;
import com.worktrac.backend.user.dto.AuthResponse;
import com.worktrac.backend.user.dto.AcceptInviteRequest;
import com.worktrac.backend.user.dto.InvitePreviewRequest;
import com.worktrac.backend.user.dto.InvitePreviewResponse;
import com.worktrac.backend.user.dto.ConfirmEmailRequest;
import com.worktrac.backend.user.dto.ForgotPasswordRequest;
import com.worktrac.backend.user.dto.LoginRequest;
import com.worktrac.backend.user.dto.MeResponse;
import com.worktrac.backend.user.dto.RegisterRequest;
import com.worktrac.backend.user.dto.RegisterStartedResponse;
import com.worktrac.backend.user.dto.ResendCodeRequest;
import com.worktrac.backend.user.dto.ResendResetCodeRequest;
import com.worktrac.backend.user.dto.ResetPasswordRequest;
import com.worktrac.backend.user.dto.StartSessionRequest;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthService authService;
    private final RegistrationService registrationService;
    private final PasswordResetService passwordResetService;
    private final CurrentUser currentUser;
    private final TokenAuthenticator tokenAuthenticator;
    private final MembershipInviteService inviteService;

    public AuthController(AuthService authService, RegistrationService registrationService,
                           PasswordResetService passwordResetService, CurrentUser currentUser,
                           TokenAuthenticator tokenAuthenticator, MembershipInviteService inviteService) {
        this.inviteService = inviteService;
        this.authService = authService;
        this.registrationService = registrationService;
        this.passwordResetService = passwordResetService;
        this.currentUser = currentUser;
        this.tokenAuthenticator = tokenAuthenticator;
    }

    @PostMapping("/register")
    public RegisterStartedResponse register(@Valid @RequestBody RegisterRequest request,
                                             HttpServletRequest servletRequest) {
        return registrationService.register(request, ClientIpResolver.resolveClientIp(servletRequest));
    }

    @PostMapping("/confirm-email")
    public AuthResponse confirmEmail(@Valid @RequestBody ConfirmEmailRequest request) {
        return registrationService.confirmEmail(request);
    }

    @PostMapping("/resend-code")
    public void resendCode(@Valid @RequestBody ResendCodeRequest request, HttpServletRequest servletRequest) {
        registrationService.resendCode(request, ClientIpResolver.resolveClientIp(servletRequest));
    }

    @PostMapping("/forgot-password")
    public void forgotPassword(@Valid @RequestBody ForgotPasswordRequest request, HttpServletRequest servletRequest) {
        passwordResetService.requestReset(request, ClientIpResolver.resolveClientIp(servletRequest));
    }

    @PostMapping("/reset-password")
    public void resetPassword(@Valid @RequestBody ResetPasswordRequest request) {
        passwordResetService.confirmReset(request);
    }

    @PostMapping("/resend-reset-code")
    public void resendResetCode(@Valid @RequestBody ResendResetCodeRequest request, HttpServletRequest servletRequest) {
        passwordResetService.resendResetCode(request, ClientIpResolver.resolveClientIp(servletRequest));
    }

    // ClientIpResolver, not getRemoteAddr() directly -- see its class comment for why: Azure
    // Container Apps appends the real client IP to X-Forwarded-For rather than replacing it, so
    // getRemoteAddr() alone (or Spring's forward-headers-strategy) trusts whatever an external
    // caller puts in that header, defeating this bucket entirely.
    @PostMapping("/login")
    public AuthResponse login(@Valid @RequestBody LoginRequest request, HttpServletRequest servletRequest) {
        return authService.login(request, ClientIpResolver.resolveClientIp(servletRequest));
    }

    /**
     * Turns "who you are" into "signed in to this household". Two callers, one route:
     * <ul>
     *   <li><b>finishing a login</b> — the Authorization header carries the five-minute selection
     *       token {@code /login} just handed back;</li>
     *   <li><b>switching household</b> — it carries an ordinary session token.</li>
     * </ul>
     *
     * <p><b>permitAll in SecurityConfig, and it has to be.</b> A selection token deliberately
     * cannot authenticate through the filter, so if this route required authentication the
     * finish-a-login case could never reach it. That is why the header is read here rather than
     * taken from the SecurityContext.
     *
     * <p>⚠️ <b>Reading the header is not the same as validating what is in it, and this route used
     * to do the first and only half of the second.</b> It called {@code JwtService.parseToken}
     * directly — signature and expiry, nothing from the database — so it accepted a token
     * invalidated by a password change, and a token scoped to a household its holder had been
     * removed from, minting a fresh 30-day session from either. Both are refused on every other
     * route in the app, by the filter, using checks that lived inline inside it.
     *
     * <p>{@link TokenAuthenticator} is now the single answer to "is this valid right now", and the
     * filter asks it the same question. {@code JwtService}'s parse methods are package-private, so
     * this class can no longer reach the weak half even by accident — the compiler enforces what
     * this comment can only ask for.
     *
     * <p><b>No password.</b> Both paths are already-proved identity, which is why the
     * authenticator's answer plus {@code AuthService.startSession}'s membership lookup are the
     * whole security of this endpoint.
     */
    @PostMapping("/session")
    public AuthResponse startSession(@Valid @RequestBody StartSessionRequest request,
                                      HttpServletRequest servletRequest) {
        String header = servletRequest.getHeader("Authorization");
        if (header == null || !header.startsWith("Bearer ")) {
            throw new UnauthorizedException("Sign in again to choose a household.");
        }

        TokenAuthenticator.TokenIdentity identity = tokenAuthenticator
                .authenticateForHouseholdChoice(header.substring(7))
                .orElseThrow(() -> new UnauthorizedException("Sign in again to choose a household."));

        return authService.startSession(identity.userId(), identity.tokenVersion(), request.accountId());
    }

    /**
     * What the /join screen needs before it can ask the right question: does this address already
     * have a Huddle account, and which household is inviting it?
     *
     * <p>permitAll, and gated by the emailed token rather than by a session — the caller may have
     * neither. See {@code MembershipInviteService.preview} for why answering this to the holder of
     * a valid link is not the user-enumeration oracle the invite design forbids: the oracle that
     * matters is the OWNER's, and an owner never sees this token.
     *
     * <p>POST rather than GET so the token stays out of access logs and Referer headers. The SPA's
     * own {@code /join?t=…} URL never reaches this server; a {@code GET ?t=…} here would.
     */
    @PostMapping("/invite/preview")
    public InvitePreviewResponse previewInvite(@Valid @RequestBody InvitePreviewRequest request) {
        MembershipInviteService.InvitePreview preview =
                inviteService.preview(request.inviteId(), request.token());
        return InvitePreviewResponse.from(preview);
    }

    /**
     * Finishes an invitation: attaches the membership and answers with a session, or with the
     * household picker when this credential now belongs to more than one household.
     *
     * <p>permitAll, and it has to be: the ordinary caller has no session — acquiring one is the
     * whole point.
     *
     * <p>⚠️ <b>The emailed token proves the LINK, never the PERSON.</b> This route used to treat
     * the two as the same thing and hand an already-registered address a full session on the
     * strength of the link alone; see {@code AuthService#acceptInvite} for what that let anyone
     * holding the link reach. All three identity decisions live in that method — this one only
     * gathers what it needs to make them.
     *
     * <p>{@code currentUser.optional()}, not the Authorization header: the header alone is not
     * proof of anything. {@code JwtAuthenticationFilter} runs on permitAll routes too, and a
     * principal reaches the context only after its signature, its {@code scp} absence and its
     * {@code tv} against the live user row have all checked out. Hand-parsing here — as
     * {@code /session} above must, for a reason that does not apply to this route — would accept a
     * token a password reset had already invalidated.
     */
    @PostMapping("/accept-invite")
    public AuthResponse acceptInvite(@Valid @RequestBody AcceptInviteRequest request,
                                      HttpServletRequest servletRequest) {
        // The two acceptance notices are published inside the service's transaction -- an
        // AFTER_COMMIT listener discards anything published from out here, after it has committed.
        // See MembershipInviteService#announce.
        return authService.acceptInvite(request,
                ClientIpResolver.resolveClientIp(servletRequest),
                currentUser.optional().map(AccountPrincipal::userId).orElse(null));
    }

    @GetMapping("/me")
    public MeResponse me() {
        return authService.me(currentUser.access());
    }
}
