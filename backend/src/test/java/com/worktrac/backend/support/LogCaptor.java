package com.worktrac.backend.support;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.slf4j.LoggerFactory;

import java.util.List;
import java.util.stream.Collectors;

// Attaches a Logback appender to a given logger for the duration of a test, so a test can
// assert an expected log line was actually emitted (e.g. RegistrationService's or
// AuthRequestLoggingFilter's outcome logging) without parsing console output. Use in a
// try-with-resources block so the appender is always detached afterward, regardless of test
// outcome, and doesn't leak into later tests sharing the same Spring context.
//
// Logback Logger instances are looked up by class name and shared JVM-wide, not scoped per
// Spring context -- under backend test class parallelism (junit-platform.properties), other
// test classes running concurrently in other threads can log through this exact same class's
// logger while this capture is active. Two consequences follow, both fixed here: (1) events()
// must filter down to only the events THIS capture's own thread produced, or an assertion
// could pass/fail based on unrelated concurrently-running tests' log noise instead of this
// test's own behavior; (2) the underlying capture list must tolerate concurrent writes from
// those other threads -- plain Logback ListAppender backs onto a non-synchronized ArrayList,
// which can silently drop or corrupt entries under concurrent add() calls. This is exactly
// what caused an intermittent "expected true but was false" failure in
// AuthControllerRateLimitTest the first time class parallelism was enabled: a concurrently
// running, unrelated test's log line raced with (and occasionally clobbered) this test's own
// expected entry on the same shared, unsynchronized list.
public final class LogCaptor implements AutoCloseable {

    private final Logger logbackLogger;
    private final ListAppender<ILoggingEvent> appender;
    private final String capturingThreadName;

    public LogCaptor(Class<?> loggedClass) {
        this.logbackLogger = (Logger) LoggerFactory.getLogger(loggedClass);
        this.appender = new SynchronizedListAppender();
        this.capturingThreadName = Thread.currentThread().getName();
        appender.start();
        logbackLogger.addAppender(appender);
    }

    public List<ILoggingEvent> events() {
        synchronized (appender.list) {
            return appender.list.stream()
                    .filter(e -> capturingThreadName.equals(e.getThreadName()))
                    .collect(Collectors.toList());
        }
    }

    @Override
    public void close() {
        logbackLogger.detachAppender(appender);
    }

    private static final class SynchronizedListAppender extends ListAppender<ILoggingEvent> {
        @Override
        protected void append(ILoggingEvent event) {
            synchronized (list) {
                super.append(event);
            }
        }
    }
}
