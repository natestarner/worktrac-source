package com.worktrac.backend.config;

import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.config.BeanDefinition;
import org.springframework.context.annotation.ClassPathScanningCandidateComponentProvider;
import org.springframework.core.type.filter.AnnotationTypeFilter;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

// Pure unit test. The backend runs as several replicas and Spring's scheduler is per JVM, so a
// @Scheduled method without @SchedulerLock runs once per replica per interval (SchedulingConfig).
// Nothing at runtime notices that -- the job still "works", just N times -- so this is the guard.
//
// The one exception is a job on a replica's OWN memory (AccessInvalidationPoller evicting from its
// own cache), which must run everywhere. It says so with @RunsOnEveryReplica and a reason, and may
// not also carry a lock.
class EveryScheduledJobIsLockedTest {

    @Test
    void everyScheduledMethodCarriesASchedulerLockWithAUniqueName() throws Exception {
        ClassPathScanningCandidateComponentProvider scanner = new ClassPathScanningCandidateComponentProvider(false);
        scanner.addIncludeFilter(new AnnotationTypeFilter(Component.class));

        List<String> scheduled = new ArrayList<>();
        List<String> unlocked = new ArrayList<>();
        List<String> lockNames = new ArrayList<>();
        for (BeanDefinition candidate : scanner.findCandidateComponents("com.worktrac.backend")) {
            Class<?> type = Class.forName(candidate.getBeanClassName());
            for (Method method : type.getDeclaredMethods()) {
                if (!method.isAnnotationPresent(Scheduled.class)) {
                    continue;
                }
                String where = type.getSimpleName() + "#" + method.getName();
                scheduled.add(where);
                SchedulerLock lock = method.getAnnotation(SchedulerLock.class);
                RunsOnEveryReplica everywhere = method.getAnnotation(RunsOnEveryReplica.class);
                if (lock != null && everywhere != null) {
                    unlocked.add(where + " (carries both @SchedulerLock and @RunsOnEveryReplica)");
                } else if (lock != null) {
                    lockNames.add(lock.name());
                } else if (everywhere == null || everywhere.value().isBlank()) {
                    unlocked.add(where);
                }
            }
        }

        assertFalse(scheduled.isEmpty(), "the scan found no @Scheduled methods at all -- it is not looking in the right place");
        assertEquals(List.of(), unlocked, "every @Scheduled method needs @SchedulerLock (or @RunsOnEveryReplica with a reason), or it runs once per replica");
        Set<String> unique = lockNames.stream().collect(Collectors.toSet());
        assertEquals(lockNames.size(), unique.size(), "two jobs sharing a lock name would block each other: " + lockNames);
    }
}
