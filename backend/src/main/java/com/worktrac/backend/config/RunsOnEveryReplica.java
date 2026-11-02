package com.worktrac.backend.config;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Marks a {@code @Scheduled} method that must run on EVERY replica, so deliberately carries no
 * {@code @SchedulerLock} (see {@code SchedulingConfig}). Only for work on a replica's own
 * in-memory state, such as evicting from its own cache. Anything that writes shared state or calls
 * out (an email, Stripe, an audit row) needs the lock instead.
 *
 * <p>{@code EveryScheduledJobIsLockedTest} accepts this in place of a lock, and requires the
 * reason.
 */
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.METHOD)
public @interface RunsOnEveryReplica {

    /** Why this job must not be limited to one replica. */
    String value();
}
