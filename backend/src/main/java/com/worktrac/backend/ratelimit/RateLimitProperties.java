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
}
