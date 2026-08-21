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
