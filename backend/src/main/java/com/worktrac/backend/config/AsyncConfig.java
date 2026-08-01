package com.worktrac.backend.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.util.concurrent.Executor;
import java.util.concurrent.ThreadPoolExecutor;

// Backs @Async methods (RegistrationEmailEventListener, AdminAlertEventListener) with a small
// dedicated pool, rather than the default SimpleAsyncTaskExecutor (unbounded, one new thread per
// task) -- email sends are infrequent and low-volume enough that a small bounded pool is plenty,
// and bounding it caps how many concurrent Azure Communication Services calls one instance can
// have in flight.
//
// CallerRunsPolicy, not the ThreadPoolTaskExecutor default (AbortPolicy): a saturated pool+queue
// must never silently drop a task. AbortPolicy throws a TaskRejectedException that Spring's
// @Async proxy has nowhere to route (the caller is the transaction-commit hook, long gone by the
// time the task would even be submitted) -- it's just logged by the JVM's default
// uncaught-exception handling and the task vanishes, exactly the blackhole a real registration
// hit in production (REGISTER_STARTED recorded, then nothing -- see the incident notes in
// CLAUDE.md). CallerRunsPolicy instead runs a rejected task synchronously on whichever thread
// submitted it (a TransactionSynchronization callback thread, off the original HTTP request
// thread already), which both guarantees the send is attempted and provides natural backpressure
// on the caller instead of an unbounded queue. Capacity is also bumped (was 2/4/50) as a second
// line of defense, sized against a burst of e2e-suite registrations plus real traffic, not to
// make CallerRunsPolicy unnecessary.
@Configuration
@EnableAsync
public class AsyncConfig {

    @Bean
    Executor emailTaskExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(4);
        executor.setMaxPoolSize(8);
        executor.setQueueCapacity(200);
        executor.setThreadNamePrefix("email-async-");
        executor.setRejectedExecutionHandler(new ThreadPoolExecutor.CallerRunsPolicy());
        executor.initialize();
        return executor;
    }
}
