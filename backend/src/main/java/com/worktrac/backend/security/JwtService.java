package com.worktrac.backend.security;

import com.worktrac.backend.config.JwtProperties;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.stereotype.Service;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Date;
import java.util.Optional;

@Service
public class JwtService {

    // The claim that marks a token as restricted, and the only value it currently takes.
    //
    // ⚠️ THE POLARITY IS THE SAFE ONE, and it is the same rule as the `role` and `tv` claims:
    // ABSENT means FULL. Every token minted before this claim existed carries no scp and must keep
    // working for its full 30 days, so "no scp" has to mean "ordinary session". The restricted kind
    // opts IN. Inverting this -- treating absent as restricted -- would sign out every existing
    // user at deploy.
    static final String SCOPE_CLAIM = "scp";
    static final String SCOPE_SELECT = "select";

    // A half-finished sign-in, not a session. See generateSelectionToken.
    private static final long SELECTION_TOKEN_MINUTES = 5;

    private final JwtProperties jwtProperties;
    private final SecretKey key;

    public JwtService(JwtProperties jwtProperties) {
        this.jwtProperties = jwtProperties;
        this.key = Keys.hmacShaKeyFor(jwtProperties.getSecret().getBytes(StandardCharsets.UTF_8));
    }

    public String generateToken(Long userId, Long accountId, String email, String role, int tokenVersion) {
        Instant now = Instant.now();
        Instant expiry = now.plus(jwtProperties.getExpirationMinutes(), ChronoUnit.MINUTES);
        return Jwts.builder()
                .subject(String.valueOf(userId))
                .claim("accountId", accountId)
                .claim("email", email)
                .claim("role", role)
                // Lets a token be invalidated before its 30-day expiry -- see V59 and
                // JwtAuthenticationFilter. Absent on tokens minted before this existed, which
                // parse as 0 and match a never-bumped row.
                .claim("tv", tokenVersion)
                .issuedAt(Date.from(now))
                .expiration(Date.from(expiry))
                .signWith(key)
                .compact();
    }

    /**
     * A short-lived token that proves WHO you are without saying WHICH household you are in.
     *
     * <p>Minted when a login resolves to two or more memberships: the password has been checked,
     * but the account is not chosen yet, so there is nothing to put in {@code accountId}. It buys
     * exactly one thing -- the right to call {@code POST /api/auth/session} and pick -- and it is
     * useless everywhere else.
     *
     * <p><b>Five minutes, not thirty days.</b> This is a half-finished sign-in sitting in a
     * browser tab, not a session. If the picker is abandoned the token should be worthless long
     * before anyone could do anything with it, and re-entering the password is the correct cost of
     * coming back to it.
     *
     * <p><b>No {@code accountId}, and an explicit {@code scp} that {@link #parseToken} refuses.</b>
     * Both halves matter -- see parseToken for why the missing accountId alone is not enough.
     */
    public String generateSelectionToken(Long userId, String email, int tokenVersion) {
        Instant now = Instant.now();
        Instant expiry = now.plus(SELECTION_TOKEN_MINUTES, ChronoUnit.MINUTES);
        return Jwts.builder()
                .subject(String.valueOf(userId))
                .claim("email", email)
                .claim("tv", tokenVersion)
                .claim(SCOPE_CLAIM, SCOPE_SELECT)
                .issuedAt(Date.from(now))
                .expiration(Date.from(expiry))
                .signWith(key)
                .compact();
    }

    /**
     * Reads a selection token back, for the one route allowed to accept one.
     *
     * <p>Deliberately a separate method rather than a flag on {@link #parseToken}: that method's
     * contract is "is this a usable session", and the answer for a selection token must stay a flat
     * no. A caller has to reach for this by name, which is a decision someone makes on purpose
     * rather than a boolean they pass by accident.
     */
    public Optional<SelectionPrincipal> parseSelectionToken(String token) {
        try {
            Claims claims = Jwts.parser()
                    .verifyWith(key)
                    .build()
                    .parseSignedClaims(token)
                    .getPayload();
            if (!SCOPE_SELECT.equals(claims.get(SCOPE_CLAIM, String.class))) {
                return Optional.empty();
            }
            Number tokenVersion = claims.get("tv", Number.class);
            return Optional.of(new SelectionPrincipal(
                    Long.valueOf(claims.getSubject()),
                    claims.get("email", String.class),
                    tokenVersion == null ? 0 : tokenVersion.intValue()));
        } catch (JwtException | IllegalArgumentException ex) {
            return Optional.empty();
        }
    }

    // Empty on any invalid/expired/malformed token -- callers treat that as "not authenticated."
    public Optional<AccountPrincipal> parseToken(String token) {
        try {
            Claims claims = Jwts.parser()
                    .verifyWith(key)
                    .build()
                    .parseSignedClaims(token)
                    .getPayload();
            Long userId = Long.valueOf(claims.getSubject());
            // ⚠️ A RESTRICTED TOKEN IS NEVER A SESSION, AND THIS SAYS SO OUT LOUD.
            //
            // A selection token also carries no accountId, so the guard below would already reject
            // it today -- but only INCIDENTALLY. The security of the whole selection-token design
            // would then rest on an absence, and the first person to add an accountId to a
            // selection token "so the picker can preselect something" would silently turn it into a
            // full 30-day session with no test failing anywhere.
            //
            // So the refusal is stated rather than emergent: any token carrying scp is refused
            // here, whatever else it carries. POST /api/auth/session parses one deliberately, by
            // calling parseSelectionToken by name.
            if (claims.get(SCOPE_CLAIM, String.class) != null) {
                return Optional.empty();
            }
            // Fails closed on a token carrying no accountId rather than throwing. This used to be
            // an unguarded .longValue(), and the resulting NullPointerException is NOT caught by
            // the JwtException | IllegalArgumentException below -- it escaped the filter entirely
            // and surfaced as a 500 instead of the 401 every other malformed token produces.
            Number accountIdClaim = claims.get("accountId", Number.class);
            if (accountIdClaim == null) {
                return Optional.empty();
            }
            Long accountId = accountIdClaim.longValue();
            String email = claims.get("email", String.class);
            // Defaults to USER for tokens issued before the role claim existed, so
            // pre-existing 30-day tokens keep working without forcing a re-login.
            String role = claims.get("role", String.class);
            // Same backward-compatibility shape as the role claim above: a token minted before
            // the claim existed reads as 0, which matches a row that has never been bumped, so
            // existing 30-day tokens keep working rather than all being invalidated at deploy.
            Number tokenVersion = claims.get("tv", Number.class);
            return Optional.of(new AccountPrincipal(userId, accountId, email, role == null ? "USER" : role,
                    tokenVersion == null ? 0 : tokenVersion.intValue()));
        } catch (JwtException | IllegalArgumentException ex) {
            return Optional.empty();
        }
    }
}
