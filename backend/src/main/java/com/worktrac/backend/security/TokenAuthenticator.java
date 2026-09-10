package com.worktrac.backend.security;

import com.worktrac.backend.membership.AccountAccessService;
import com.worktrac.backend.user.UserRepository;
import org.springframework.stereotype.Service;

import java.util.Optional;

/**
 * The one answer to "is this token valid right now, and whose is it?".
 *
 * <p>── ⚠️ WHY THIS CLASS EXISTS ───────────────────────────────────────────────────────────────
 *
 * <p><b>"Valid" used to have two definitions and only one of them was reachable by name.</b>
 * {@link JwtService#parseToken} checks a signature, an expiry, the absence of {@code scp} and the
 * presence of {@code accountId}. The <b>rest</b> of validation — the {@code tv} claim against the
 * live {@code users} row, and a membership that still exists — lived inline inside
 * {@link JwtAuthenticationFilter}. So "fully validated" was a property of <i>having gone through
 * the filter</i>, not something a caller could ask for.
 *
 * <p>That is a trap rather than an inconvenience. A route that cannot go through the filter reaches
 * for the only public thing available, gets the weaker half, and nothing at the call site says so —
 * {@code parseToken} reads as complete. {@code POST /api/auth/session} did exactly that, and
 * therefore accepted tokens every other route had already refused: it swapped a password-revoked
 * token for a fresh 30-day one, and honoured a token scoped to a household its holder had been
 * removed from. See {@code docs/incidents/2026-09-10-invite-link-was-a-passwordless-session.md}.
 *
 * <p><b>The fix is enforced by the compiler, not by a checklist.</b> {@code JwtService}'s two parse
 * methods are now package-private, and this class lives in that same package. Every consumer
 * outside {@code ..security} — {@code AuthController} above all — can no longer reach the weak half
 * at all. A guard test would only have reported the mistake afterwards; this makes it unwritable.
 *
 * <p><b>Do not add a method here that returns a principal without checking freshness.</b> The whole
 * value of this class is that holding one of its results means the credential was live at that
 * moment. A "just parse it for me" convenience method rebuilds the trap it exists to close.
 *
 * <p>{@code JwtService} keeps exactly one job — minting and cryptographically reading tokens, with
 * no database — and this class owns freshness. Two jobs, two classes, one public door.
 */
@Service
public class TokenAuthenticator {

    private final JwtService jwtService;
    private final AccountAccessService accountAccessService;
    private final UserRepository userRepository;

    public TokenAuthenticator(JwtService jwtService, AccountAccessService accountAccessService,
                               UserRepository userRepository) {
        this.jwtService = jwtService;
        this.accountAccessService = accountAccessService;
        this.userRepository = userRepository;
    }

    /**
     * A full session token, validated end to end, with its {@link AccountAccess} attached.
     *
     * <p>Empty covers four cases that a caller must treat identically, because every one of them
     * means the token is no longer usable: it is not a token this server signed (or it has
     * expired, or it is a restricted kind), the membership never existed, it has been revoked, or
     * a password change bumped the user's token version.
     *
     * <p>The single {@code resolve} call answers the last three at once and is what
     * {@link JwtAuthenticationFilter} always did; lifting it here is what lets a route that cannot
     * use the filter get the identical answer.
     */
    public Optional<AccountPrincipal> authenticate(String rawToken) {
        return jwtService.parseToken(rawToken)
                .flatMap(principal -> accountAccessService
                        .resolve(principal.userId(), principal.accountId(), principal.tokenVersion())
                        .map(principal::withAccess));
    }

    /**
     * Identity for the one route that legitimately accepts <b>either</b> kind of token:
     * {@code POST /api/auth/session}, which both finishes a multi-household login (selection token)
     * and switches household (full session token).
     *
     * <p>Selection token first — it is the narrower kind and the one that route exists for. Falling
     * through to a full token second is what keeps "switch household" the same route rather than a
     * near-duplicate of it.
     *
     * <p>⚠️ <b>Both branches are fully validated before they get here</b>, and the two are NOT
     * validated identically — deliberately. A full token names a household, so its membership is
     * checked. A selection token names none, which is the entire point of it, so there is nothing
     * to check beyond the token version. That asymmetry is real rather than an oversight, and it is
     * why this returns a bare identity instead of a principal: at this moment the caller genuinely
     * has a user and no account, and inventing one to satisfy a shared type would be a lie.
     */
    public Optional<TokenIdentity> authenticateForHouseholdChoice(String rawToken) {
        return authenticateSelection(rawToken)
                .map(selection -> new TokenIdentity(selection.userId(), selection.tokenVersion()))
                .or(() -> authenticate(rawToken)
                        .map(principal -> new TokenIdentity(principal.userId(), principal.tokenVersion())));
    }

    /**
     * A selection token, plus the freshness check the filter would have applied.
     *
     * <p>Private on purpose: a selection token buys exactly one thing, and letting a second caller
     * ask for one directly is how it starts buying more. {@code JwtService.parseSelectionToken} is
     * package-private for the same reason one layer down.
     */
    private Optional<SelectionPrincipal> authenticateSelection(String rawToken) {
        return jwtService.parseSelectionToken(rawToken)
                .filter(selection -> userRepository.findById(selection.userId())
                        .map(user -> user.getTokenVersion() == selection.tokenVersion())
                        .orElse(false));
    }

    /**
     * The two claims shared by both kinds of token, for the one route allowed to take either.
     *
     * <p>{@code SelectionPrincipal} and {@code AccountPrincipal} are deliberately separate types
     * with no common supertype — the compiler enforcing "a restricted token is never a session" is
     * the point of that split, and giving them a shared interface to tidy this up would give it
     * away. This is the narrow union of what both legitimately carry.
     *
     * <p>{@code tokenVersion} travels with the id rather than being dropped here, because
     * {@code AuthService.startSession} re-checks it: that method has a caller with no token at all
     * ({@code PasswordChangeService}), so it cannot assume validation happened upstream.
     */
    public record TokenIdentity(Long userId, int tokenVersion) {
    }
}
