package com.worktrac.backend.user;

import com.worktrac.backend.ratelimit.RateLimitProperties;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * ⚠️ <b>The per-email rate limit and the account lockout are a PAIR, not two independent knobs.</b>
 *
 * <p>Both are driven by the same failed login attempts, but only one of them is cleared by a
 * password reset:
 *
 * <ul>
 *   <li>the <b>account lockout</b> ({@link AuthService#MAX_FAILED_LOGINS}, 15 minutes) IS cleared —
 *   {@code PasswordResetService.confirmReset} calls {@code clearLoginLockout()};</li>
 *   <li>the <b>per-email rate limit</b> is NOT, and cannot be: refilling a rate-limit bucket from
 *   an unauthenticated route would itself be abusable.</li>
 * </ul>
 *
 * <p>So if the limit is set at or below the lockout ceiling, tripping the lockout necessarily
 * empties the bucket too — and somebody who does exactly what the lockout message tells them
 * (<i>"Try again in a few minutes, or reset your password to get back in right away"</i>) is then
 * refused by the rate limiter for the rest of the hour, with no message explaining why and nothing
 * they can do about it. The promise becomes false at the moment it is read.
 *
 * <p><b>A unit test, deliberately, and it is the only thing that can guard this.</b> Every
 * integration test runs under {@code @ActiveProfiles("local")}, and {@code application-local.yml}
 * sets this limit to 100000 so the e2e suite cannot trip it — so no integration test can observe
 * the production default at all. An integration test asserting this would pass at 100000 whatever
 * the default was, which is exactly the vacuous guard this codebase keeps catching.
 */
@DisplayName("the login rate limit and the account lockout")
class LoginLimitPairingTest {

    @Test
    void perEmailLimitStaysAboveTheLockoutCeilingSoAResetCanActuallyGetYouBackIn() {
        int perEmailPerHour = new RateLimitProperties().getLoginPerEmailPerHour();

        assertThat(perEmailPerHour)
                .describedAs(
                        "app.rate-limit.login-per-email-per-hour (%d) must exceed "
                                + "AuthService.MAX_FAILED_LOGINS (%d). At or below it, hitting the "
                                + "account lockout also empties this bucket -- and a password reset "
                                + "clears the lockout but not the bucket, so the lockout message's "
                                + "\"reset your password to get back in right away\" stops being true.",
                        perEmailPerHour, AuthService.MAX_FAILED_LOGINS)
                .isGreaterThan(AuthService.MAX_FAILED_LOGINS);
    }

    /**
     * The other half of the ordering: the narrowest bucket has to actually be the narrowest, or
     * {@code checkLoginAllowed}'s narrowest-first sequence refuses on the wrong one and reports a
     * message naming the wrong bound.
     */
    @Test
    void theBucketsAreOrderedNarrowestFirst() {
        RateLimitProperties properties = new RateLimitProperties();

        assertThat(properties.getLoginPerEmailPerHour())
                .describedAs("per-email must be the narrowest login bucket")
                .isLessThan(properties.getLoginPerIpPerHour());
        assertThat(properties.getLoginPerIpPerHour())
                .describedAs("per-IP must be narrower than the global backstop")
                .isLessThan(properties.getLoginGlobalPerHour());
    }
}
