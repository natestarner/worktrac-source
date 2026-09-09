package com.worktrac.backend.user;

import com.worktrac.backend.common.ForbiddenException;
import com.worktrac.backend.common.LockedException;
import com.worktrac.backend.common.UnauthorizedException;
import com.worktrac.backend.membership.AccountAccessService;
import com.worktrac.backend.user.dto.AuthResponse;
import com.worktrac.backend.user.dto.ChangePasswordRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;

/**
 * Changing your own password from inside a live session.
 *
 * <p>Separate from {@link PasswordResetService} on purpose. A reset proves control of the MAILBOX
 * and is reached by somebody who is signed out; a change proves knowledge of the CURRENT PASSWORD
 * and is reached by somebody already signed in. They defend against different things, so merging
 * them would mean one of the two proofs becoming optional.
 *
 * <p>⚠️ <b>There is no owner-side counterpart, and there must never be one.</b> An owner who can
 * set a member's password can impersonate that member. The member's Profile page carries
 * "{owner} cannot see or set your password" as a standing promise; this class, and the absence of
 * any sibling to it, is what makes that true.
 */
@Service
public class PasswordChangeService {

    private static final Logger log = LoggerFactory.getLogger(PasswordChangeService.class);

    // The same ceiling and cooldown login uses, and deliberately the SAME counter on the user row
    // rather than a second one. Somebody holding a borrowed unlocked phone gets one budget for
    // guessing a password, not one per screen that asks for it.
    private static final int MAX_FAILED_ATTEMPTS = 10;
    private static final Duration LOCKOUT_DURATION = Duration.ofMinutes(15);

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final AccountAccessService accountAccessService;
    private final AuthService authService;
    private final Clock clock;

    public PasswordChangeService(UserRepository userRepository, PasswordEncoder passwordEncoder,
                                  AccountAccessService accountAccessService, AuthService authService,
                                  Clock clock) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
        this.accountAccessService = accountAccessService;
        this.authService = authService;
        this.clock = clock;
    }

    /**
     * Verifies the current password, sets the new one, and hands back a fresh session.
     *
     * <p><b>Why a new token comes back.</b> Changing a password bumps {@code token_version}, which
     * invalidates every token this user holds — including the one that made this very request. The
     * caller would otherwise be silently signed out by their own successful action, land on the
     * login screen, and reasonably conclude the change failed. So the session is re-minted here and
     * the client swaps it in, exactly as {@code switchHousehold} does.
     *
     * <p><b>Why the version is bumped at all.</b> Changing a password is very often prompted by the
     * suspicion that somebody else has access. Leaving their other sessions alive for up to thirty
     * more days, on a screen that implies the opposite, is the same failure
     * {@code PasswordResetService} already refuses to ship.
     */
    @Transactional
    public AuthResponse changePassword(Long userId, Long accountId, ChangePasswordRequest request) {
        Instant now = clock.instant();
        // The session already proved this id exists; a miss here means the account was deleted
        // mid-request, which is the signed-out path rather than a distinct error.
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UnauthorizedException("That login is no longer active."));

        // Checked BEFORE the comparison, so a locked account costs no BCrypt -- login's ordering,
        // for login's reason.
        if (user.isLockedAt(now)) {
            log.warn("Password change refused for user {}: locked until {}", userId, user.getLockedUntil());
            throw new LockedException("Too many failed attempts. Try again in a few minutes.");
        }

        if (!passwordEncoder.matches(request.currentPassword(), user.getPasswordHash())) {
            user.recordFailedLogin(MAX_FAILED_ATTEMPTS, now, LOCKOUT_DURATION);
            userRepository.save(user);
            log.warn("Password change refused for user {}: wrong current password", userId);
            // NOT UnauthorizedException. This route is only reachable WITH a valid session token --
            // api/client.js treats ANY 401 on a request that carried one as "the session itself is
            // invalid" and force-signs-out to /login, discarding whatever message came with it
            // (see its `hadToken` branch). That rule is deliberately blunt everywhere else it
            // applies (a stale/revoked token), but it is wrong here: the bearer token is fine, and
            // what failed is a SECOND credential this endpoint itself asked for. A 401 here silently
            // signed the person out with no explanation, which read as "changing your password
            // kicks you to the login screen" -- see docs/incidents/2026-09-09 for the repro. 403
            // reaches ChangePasswordSection.jsx's `showServerMessage` path instead, exactly as the
            // lockout case below already does at 423.
            throw new ForbiddenException("That isn't your current password.");
        }

        user.updatePasswordHash(passwordEncoder.encode(request.newPassword()));
        // Proving the current password is at least as strong as proving it at login, so a lockout
        // earned by earlier guesses is spent -- otherwise somebody who just demonstrated they know
        // their password stays locked out of signing in with it.
        user.clearLoginLockout();
        user.bumpTokenVersion();
        userRepository.save(user);

        // token_version lives on the cached AccountAccess row, so without this the old value keeps
        // answering for up to 60s on this replica -- and the fresh token minted below would be
        // rejected as stale by its own successful request.
        accountAccessService.invalidateUser(user.getId());

        log.info("Password changed for user {}", userId);
        return authService.startSession(userId, accountId);
    }
}
