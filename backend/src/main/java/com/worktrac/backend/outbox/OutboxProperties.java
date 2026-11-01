package com.worktrac.backend.outbox;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.List;

// app.outbox.* -- see Outbox and OutboxDispatcher.
//
// The defaults are the production values. Integration tests override two of them
// (AbstractIntegrationTest): one attempt and no background poll, so a test that stubs a send to
// fail sees the final outcome at once, and no retry fires later into some other test's stubbing.
@Component
@ConfigurationProperties(prefix = "app.outbox")
public class OutboxProperties {

    // 1 immediate attempt + 4 retries. With the backoff below the last retry lands ~9.5 minutes
    // after the first failure -- inside a verification code's 15-minute life, and inside
    // RegistrationDispatchWatchdog's grace period, so a row still retrying is never reported as
    // never dispatched.
    private int maxAttempts = 5;

    // Delay before attempt 2, 3, 4, 5. The last entry repeats if maxAttempts is raised.
    private List<Duration> backoff = List.of(
            Duration.ofSeconds(30), Duration.ofMinutes(1), Duration.ofMinutes(3), Duration.ofMinutes(5));

    // How often every replica looks for due rows. Only a safety net -- each row is first tried
    // straight after its commit, by the replica that wrote it -- so it covers retries and rows whose
    // replica died before trying them.
    private Duration pollInterval = Duration.ofSeconds(5);

    // A replica's lease on a row while it sends. Longer than any send can take (EmailService bounds
    // the ACS call at 2 minutes), or a slow send could be reclaimed and sent twice.
    private Duration claimDuration = Duration.ofMinutes(5);

    // Rows claimed per poll, per replica.
    private int batchSize = 20;

    // SENT rows are kept this long for diagnosis, then deleted. FAILED rows are never deleted
    // automatically.
    private Duration sentRetention = Duration.ofDays(30);

    public int getMaxAttempts() {
        return maxAttempts;
    }

    public void setMaxAttempts(int maxAttempts) {
        this.maxAttempts = maxAttempts;
    }

    public List<Duration> getBackoff() {
        return backoff;
    }

    public void setBackoff(List<Duration> backoff) {
        this.backoff = backoff;
    }

    public Duration getPollInterval() {
        return pollInterval;
    }

    public void setPollInterval(Duration pollInterval) {
        this.pollInterval = pollInterval;
    }

    public Duration getClaimDuration() {
        return claimDuration;
    }

    public void setClaimDuration(Duration claimDuration) {
        this.claimDuration = claimDuration;
    }

    public int getBatchSize() {
        return batchSize;
    }

    public void setBatchSize(int batchSize) {
        this.batchSize = batchSize;
    }

    public Duration getSentRetention() {
        return sentRetention;
    }

    public void setSentRetention(Duration sentRetention) {
        this.sentRetention = sentRetention;
    }

    /** The delay before attempt {@code nextAttempt} (2-based). */
    Duration backoffBefore(int nextAttempt) {
        int index = Math.min(Math.max(nextAttempt - 2, 0), backoff.size() - 1);
        return backoff.get(index);
    }
}
