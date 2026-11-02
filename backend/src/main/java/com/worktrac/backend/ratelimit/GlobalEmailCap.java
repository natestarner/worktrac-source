package com.worktrac.backend.ratelimit;

import com.worktrac.backend.registrationaudit.RegistrationAuditService;
import com.worktrac.backend.registrationaudit.RegistrationEventRepository;
import com.worktrac.backend.registrationaudit.RegistrationEventType;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Duration;

// The system-wide ceiling on the emails the two UNAUTHENTICATED email endpoints can cause --
// /register + /resend-code, and /forgot-password + /resend-reset-code. Those are the only places an
// anonymous caller can make this app send mail, so this is the defence against a distributed bot
// running up the Azure Communication Services bill (per-IP limits alone don't stop a bot that
// rotates source addresses or target emails).
//
// COUNTED FROM THE OUTBOX, NOT A BUCKET. It used to be a Bucket4j bucket in each JVM, which made the
// real ceiling N x the configured one at N replicas, and -- at 30/hour -- low enough that a burst of
// real sign-ups would have been turned away. The outbox already holds a row for every email queued,
// on every replica, so "how many user-facing emails were queued in the last hour" is one indexed
// count against the shared database (V88). It runs only on those two endpoints.
//
// TWO NUMBERS:
//   warning (APP_RATE_LIMIT_GLOBAL_EMAIL_WARNING_PER_HOUR, default 150) -- refuses nothing. Records
//     EMAIL_VOLUME_HIGH, which alerts the admin (the send-failure alert toggle), at most once an hour.
//     A spike might be marketing working or a bot; a person should look.
//   hard cap (APP_RATE_LIMIT_GLOBAL_EMAIL_SENDS_PER_HOUR, default 1000) -- refuses with 429. Set it
//     just below the hourly quota Azure has actually granted this sender, so the app refuses
//     politely before ACS starts throttling.
//
// What counts: every email.* outbox row EXCEPT the two that go to the admin (admin alerts and
// Contact Us alerts). Admin mail is never refused by this cap -- an alert about the volume must
// still get out -- and Contact Us has its own limiter (ContactRateLimiter).
//
// Note an unknown address on /forgot-password queues no email, so it no longer spends from this
// budget. That is not an enumeration oracle: the cap's answer depends only on the global count,
// identically for known and unknown addresses, and the per-IP limiter (which runs for both) is
// unchanged.
@Component
public class GlobalEmailCap {

    private static final Logger log = LoggerFactory.getLogger(GlobalEmailCap.class);

    static final String COUNT_SQL = "SELECT COUNT(*) FROM outbox "
            + "WHERE created_at >= DATEADD(HOUR, -1, SYSUTCDATETIME()) "
            + "AND handler LIKE 'email.%' AND handler NOT IN ('email.admin-alert', 'email.contact-alert')";

    private static final Duration WARNING_INTERVAL = Duration.ofHours(1);

    private final JdbcTemplate jdbc;
    private final RateLimitProperties properties;
    private final RegistrationAuditService auditService;
    private final RegistrationEventRepository eventRepository;
    private final Clock clock;

    public GlobalEmailCap(JdbcTemplate jdbc, RateLimitProperties properties, RegistrationAuditService auditService,
                          RegistrationEventRepository eventRepository, Clock clock) {
        this.jdbc = jdbc;
        this.properties = properties;
        this.auditService = auditService;
        this.eventRepository = eventRepository;
        this.clock = clock;
    }

    /** True if one more user-facing email may be queued now. */
    public boolean tryAllow() {
        Integer queued = jdbc.queryForObject(COUNT_SQL, Integer.class);
        int lastHour = queued == null ? 0 : queued;

        if (lastHour >= properties.getGlobalEmailSendsPerHour()) {
            log.warn("Global email cap reached: {} user-facing emails queued in the last hour (cap {})",
                    lastHour, properties.getGlobalEmailSendsPerHour());
            warnOnce(lastHour, true);
            return false;
        }
        if (lastHour >= properties.getGlobalEmailWarningPerHour()) {
            warnOnce(lastHour, false);
        }
        return true;
    }

    // At most one alert an hour across every replica: the check reads the audit table, which every
    // replica shares. Two replicas crossing the line in the same instant could both record one --
    // a duplicate alert, harmless.
    private void warnOnce(int lastHour, boolean refusing) {
        try {
            boolean alreadyWarned = eventRepository.existsByEventTypeAndCreatedAtGreaterThanEqual(
                    RegistrationEventType.EMAIL_VOLUME_HIGH, clock.instant().minus(WARNING_INTERVAL));
            if (alreadyWarned) {
                return;
            }
            auditService.record("system", RegistrationEventType.EMAIL_VOLUME_HIGH,
                    lastHour + " user-facing emails queued in the last hour (warning at "
                            + properties.getGlobalEmailWarningPerHour() + ", hard cap "
                            + properties.getGlobalEmailSendsPerHour() + ")"
                            + (refusing ? " -- the hard cap is now REFUSING sign-up and reset emails" : "")
                            + ". Check for abuse, or raise the caps and the ACS quota if this is real traffic.",
                    null);
        } catch (RuntimeException e) {
            // The warning is advisory; never let it fail the request it was observing.
            log.error("Could not record the email-volume warning", e);
        }
    }
}
