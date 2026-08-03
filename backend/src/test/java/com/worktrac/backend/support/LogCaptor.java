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
// Logback's LoggerContext is a JVM-wide singleton, not scoped per Spring context -- under
// backend test class parallelism (junit-platform.properties), this is unsafe for a test class
// running concurrently with others in two independently confirmed ways: (1) another test
// class's log calls can land in this capture's list at the same time (plain Logback
// ListAppender backs onto a non-synchronized ArrayList, which can silently drop/corrupt
// entries under concurrent add()), and (2) Spring Boot's LogbackLoggingSystem calls
// LoggerContext.reset() when ANY other Spring context boots concurrently, which detaches every
// manually-attached appender -- including this one -- for the rest of the run. (2) proved
// resistant to a reset-resistant LoggerContextListener re-attach hook (confirmed via a debug
// build: the appender still ended up detached even with re-attachment firing on the first
// reset, implying more than one wipe can happen in sequence). Given that, the class actually
// using this (AuthControllerRateLimitTest) is marked @Isolated instead -- JUnit runs it with no
// other test executing concurrently, which removes both problems at the source rather than
// fighting them here. The synchronization below is kept as cheap, correct defense in depth for
// any future LogCaptor use that ISN'T under @Isolated.
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
