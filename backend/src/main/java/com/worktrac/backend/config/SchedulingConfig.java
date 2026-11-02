package com.worktrac.backend.config;

import javax.sql.DataSource;
import net.javacrumbs.shedlock.core.LockProvider;
import net.javacrumbs.shedlock.provider.jdbctemplate.JdbcTemplateLockProvider;
import net.javacrumbs.shedlock.spring.annotation.EnableSchedulerLock;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.EnableScheduling;

// Enables @Scheduled methods app-wide -- RegistrationDispatchWatchdog's periodic reconciliation
// check, and SubscriptionReconciliationWatchdog's hourly billing-drift sweep.
//
// ⚠️ EVERY @Scheduled METHOD ALSO NEEDS @SchedulerLock. The backend runs as several replicas, and
// Spring's scheduler is per JVM: without a lock, each replica runs each job on its own timer. ShedLock
// turns that into once per interval across all of them -- a row per job in the `shedlock` table
// (V85__create_shedlock_table.sql) that one replica claims atomically while the others skip.
//
// The two numbers on each @SchedulerLock:
//   lockAtLeastFor -- how long the lock is held even after the job finishes. Set just under the
//                     job's interval, so a replica whose timer fires a minute later than the
//                     winner's skips instead of running the same sweep again.
//   lockAtMostFor  -- the crash fallback: if the winner dies mid-run, the lock frees itself after
//                     this long. That interval's run is then simply skipped; both watchdogs re-scan
//                     a time window on the next tick, so nothing is lost.
//
// usingDbTime(): lock_until is computed from the database's clock rather than each replica's, so
// skew between containers cannot make two replicas both think the lock has expired.
@Configuration
@EnableScheduling
@EnableSchedulerLock(defaultLockAtMostFor = "PT10M")
public class SchedulingConfig {

    @Bean
    public LockProvider lockProvider(DataSource dataSource) {
        return new JdbcTemplateLockProvider(JdbcTemplateLockProvider.Configuration.builder()
                .withJdbcTemplate(new JdbcTemplate(dataSource))
                .withTableName("shedlock")
                .usingDbTime()
                .build());
    }
}
