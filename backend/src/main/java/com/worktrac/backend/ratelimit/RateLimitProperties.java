package com.worktrac.backend.ratelimit;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Component
@ConfigurationProperties(prefix = "app.rate-limit")
public class RateLimitProperties {

    // Shared by /register and /resend-code -- both cost a real ACS send per hit,
    // so one bucket per source IP covers the abuse case for either endpoint.
    private int perIpPerHour = 10;

    // System-wide cap on verification emails sent (register + resend combined),
    // regardless of source IP or email. This is the real defense against a
    // distributed bot running up the Azure Communication Services bill -- per-IP
    // limits only bound a single source. Sized with headroom above the ~7 emails
    // one full Playwright e2e run against `lower` sends per deploy.
    private int globalEmailSendsPerHour = 30;

    public int getPerIpPerHour() {
        return perIpPerHour;
    }

    public void setPerIpPerHour(int perIpPerHour) {
        this.perIpPerHour = perIpPerHour;
    }

    public int getGlobalEmailSendsPerHour() {
        return globalEmailSendsPerHour;
    }

    public void setGlobalEmailSendsPerHour(int globalEmailSendsPerHour) {
        this.globalEmailSendsPerHour = globalEmailSendsPerHour;
    }

    // Login limits (LoginRateLimiter). /api/auth/login had no throttle of any kind before this.
    //
    // ⚠️ THE NARROWEST BUCKET, and the one that actually bounds guessing at a single account.
    //
    // 20/hour against ONE ADDRESS. A household re-authenticating never comes close: even a whole
    // family on several devices is a handful of logins a day, and they are spread across different
    // addresses now that each member has their own.
    //
    // ⚠️ <b>IT MUST STAY ABOVE AuthService.MAX_FAILED_LOGINS (10), and that is a correctness
    // constraint rather than a tuning preference.</b> The account lockout and this bucket are
    // triggered by the same attempts, but only the lockout is cleared by a password reset
    // (PasswordResetService.confirmReset -> clearLoginLockout). Set equal to the lockout ceiling,
    // hitting the lockout necessarily empties this bucket too -- so somebody who forgot their
    // password, tripped the lockout, and reset it as instructed would then be refused by the rate
    // limiter for the rest of the hour, and the lockout message
    //
    //     "Too many failed attempts. Try again in a few minutes, or reset your password to get
    //      back in right away."
    //
    // would be a lie at the exact moment it is read. Twenty leaves the lockout as the thing a real
    // account hits first, with headroom to sign in immediately afterwards. Pinned by
    // LoginPerEmailRateLimitTest#aPasswordResetLetsSomebodyStraightBackIn.
    //
    // The bucket still does its own job: for an address with NO account there is no lockout at all,
    // so this is the only per-address bound that exists there -- which is exactly the case the
    // enumeration rule below is about.
    //
    // It is what makes the per-IP bound safe to RAISE. Before member logins, per-IP at 60 was
    // doing two jobs -- bounding guessing and bounding load -- and doing the first badly, since an
    // attacker on 60 IPs got 3600 attempts at one account. Splitting them lets each be sized for
    // its own job.
    //
    // ⚠️ <b>IT MUST BE CONSUMED FOR EVERY SUBMITTED ADDRESS, whether or not an account exists.</b>
    // Consuming only for known emails makes "which addresses eventually 429" a user-enumeration
    // oracle -- exactly what DUMMY_HASH and PasswordResetService's non-enumerating design exist to
    // close, reintroduced through the rate limiter instead of the response. See
    // AuthService.checkLoginAllowed, where it is consumed BEFORE the user lookup for that reason.
    private int loginPerEmailPerHour = 20;

    // Now a pure DoS/CPU bound rather than an anti-guessing one -- that job moved to the per-email
    // bucket above, which does it far better. Raised 60 -> 300 because the old value was shaped by
    // the job it no longer has, and 60/hour is genuinely reachable by legitimate traffic once a
    // household has several member logins behind one home NAT, or a gym's shared wifi. Locking a
    // real family out mid-workout is a worse outcome than a looser bound on a request that costs
    // ~100ms of BCrypt.
    private int loginPerIpPerHour = 300;

    // Backstop against a distributed attempt that rotates source IPs. Sized well above any
    // plausible real total, so it engages only under genuine attack rather than shaping normal use.
    private int loginGlobalPerHour = 2000;

    public int getLoginPerEmailPerHour() {
        return loginPerEmailPerHour;
    }

    public void setLoginPerEmailPerHour(int loginPerEmailPerHour) {
        this.loginPerEmailPerHour = loginPerEmailPerHour;
    }

    public int getLoginPerIpPerHour() {
        return loginPerIpPerHour;
    }

    public void setLoginPerIpPerHour(int loginPerIpPerHour) {
        this.loginPerIpPerHour = loginPerIpPerHour;
    }

    public int getLoginGlobalPerHour() {
        return loginGlobalPerHour;
    }

    public void setLoginGlobalPerHour(int loginGlobalPerHour) {
        this.loginGlobalPerHour = loginGlobalPerHour;
    }

    // Contact-form limits (ContactRateLimiter). Separate buckets from the registration ones above
    // so a burst of contact messages can't lock anyone out of registering, and vice versa.
    //
    // Sized far tighter than the registration limits because the endpoint is authenticated: 5/hour
    // is generous for a real person reporting a bug and implausible for anything else. A household
    // member who legitimately hits it can still write again an hour later, and nothing they typed
    // is lost -- the draft survives the 429.
    private int contactPerUserPerHour = 5;

    private int contactPerIpPerHour = 10;

    // Bounds total admin-alert email spend, the same job globalEmailSendsPerHour does for
    // verification sends. Higher than the per-user cap so a genuinely busy day never silently
    // swallows the third person's report.
    private int contactGlobalPerHour = 20;

    public int getContactPerUserPerHour() {
        return contactPerUserPerHour;
    }

    public void setContactPerUserPerHour(int contactPerUserPerHour) {
        this.contactPerUserPerHour = contactPerUserPerHour;
    }

    public int getContactPerIpPerHour() {
        return contactPerIpPerHour;
    }

    public void setContactPerIpPerHour(int contactPerIpPerHour) {
        this.contactPerIpPerHour = contactPerIpPerHour;
    }

    public int getContactGlobalPerHour() {
        return contactGlobalPerHour;
    }

    public void setContactGlobalPerHour(int contactGlobalPerHour) {
        this.contactGlobalPerHour = contactGlobalPerHour;
    }
}
