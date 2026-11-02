package com.worktrac.backend.membership;

import com.worktrac.backend.config.RunsOnEveryReplica;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Duration;

// Brings invalidations made on OTHER replicas into this replica's AccountAccessService cache.
// See AccessInvalidationLog for why every poll replays a window instead of reading from a cursor.
//
// Cost per replica: one indexed seek every couple of seconds that normally returns no rows. A
// polling interval rather than a push (Redis pub/sub, Service Bus) because ~2s is plenty for every
// change this carries -- a revocation, a plan change, a visibility setting -- and it needs nothing
// beyond the database every replica already has.
@Component
public class AccessInvalidationPoller {

    private static final Logger log = LoggerFactory.getLogger(AccessInvalidationPoller.class);

    static final Duration RETENTION = Duration.ofHours(1);

    private final AccessInvalidationLog invalidationLog;
    private final AccountAccessService accountAccessService;
    private boolean failing;

    public AccessInvalidationPoller(AccessInvalidationLog invalidationLog,
                                    AccountAccessService accountAccessService) {
        this.invalidationLog = invalidationLog;
        this.accountAccessService = accountAccessService;
    }

    @Scheduled(fixedDelayString = "${app.access.invalidation-poll-interval:PT2S}")
    @RunsOnEveryReplica("each replica evicts from its OWN in-memory cache; a lock would leave the "
            + "others stale")
    public void applyRecentInvalidations() {
        try {
            for (AccessInvalidationLog.Entry entry : invalidationLog.recent()) {
                accountAccessService.evictLocally(entry.userId(), entry.accountId());
            }
            if (failing) {
                log.info("Access invalidation polling recovered");
                failing = false;
            }
        } catch (RuntimeException e) {
            // Database unreachable: every request is failing too, and the cache's own 60s TTL still
            // bounds how stale an entry can get. Logged once per outage, not every two seconds.
            if (!failing) {
                log.warn("Access invalidation polling failed; cache entries fall back to their 60s TTL", e);
                failing = true;
            }
        }
    }

    // The table only has to cover the replay window; an hour keeps a little history to read when
    // diagnosing. Any replica may run it, but only one needs to.
    @Scheduled(fixedDelayString = "PT1H", initialDelayString = "PT10M")
    @SchedulerLock(name = "accessInvalidationPurge", lockAtLeastFor = "PT55M", lockAtMostFor = "PT59M")
    public void purgeOldInvalidations() {
        int purged = invalidationLog.purgeOlderThan(RETENTION);
        if (purged > 0) {
            log.debug("Purged {} access invalidation rows older than {}", purged, RETENTION);
        }
    }
}
