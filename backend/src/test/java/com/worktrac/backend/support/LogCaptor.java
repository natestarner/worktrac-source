package com.worktrac.backend.support;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.slf4j.LoggerFactory;

import java.util.List;

// Attaches a Logback ListAppender to a given logger for the duration of a test, so a test can
// assert an expected log line was actually emitted (e.g. RegistrationService's or
// AuthRequestLoggingFilter's outcome logging) without parsing console output. Use in a
// try-with-resources block so the appender is always detached afterward, regardless of test
// outcome, and doesn't leak into later tests sharing the same Spring context.
public final class LogCaptor implements AutoCloseable {

    private final Logger logbackLogger;
    private final ListAppender<ILoggingEvent> appender;

    public LogCaptor(Class<?> loggedClass) {
        this.logbackLogger = (Logger) LoggerFactory.getLogger(loggedClass);
        this.appender = new ListAppender<>();
        appender.start();
        logbackLogger.addAppender(appender);
    }

    public List<ILoggingEvent> events() {
        return appender.list;
    }

    @Override
    public void close() {
        logbackLogger.detachAppender(appender);
    }
}
