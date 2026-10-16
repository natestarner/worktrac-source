package com.worktrac.backend.support;

import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.util.concurrent.Executor;

/**
 * Waits for the {@code emailTaskExecutor} to have nothing running or queued.
 *
 * <p>Every email goes out from an {@code @Async("emailTaskExecutor")} listener, on a pool thread,
 * into a test's {@code @MockitoBean EmailService}. Mockito stubbing is not safe against a mock
 * being invoked on another thread mid-stub: {@code doThrow(...).when(emailService)} parks the
 * answer on the mock itself, and a pool thread calling any method before the stubbed call lands
 * takes it, leaving the test thread with {@code UnfinishedStubbingException}. That is the
 * {@code PasswordResetControllerTest} failure CI hit with only one class running at a time: the
 * registration success email, still in flight from the line before, landed between line 299's
 * {@code when(emailService)} and line 300's call.
 *
 * <p>Tasks are submitted while the request commits ({@code AFTER_COMMIT}), so once MockMvc has
 * returned, an idle pool means no thread is about to touch the mock. Call this before stubbing
 * after anything that sends email, and from {@code @AfterEach} so one test's sends cannot land in
 * the next test's stubbing or in the mock reset Spring runs after each test.
 */
public final class EmailTestSupport {

    private EmailTestSupport() {
    }

    // Idle on several consecutive checks, not one: ThreadPoolExecutor's active count is approximate,
    // and a worker that has just taken a task off the queue is briefly counted nowhere.
    public static void awaitEmailsIdle(Executor emailTaskExecutor) {
        ThreadPoolTaskExecutor pool = (ThreadPoolTaskExecutor) emailTaskExecutor;
        long deadline = System.currentTimeMillis() + 10_000;
        int idleChecks = 0;
        while (idleChecks < 3) {
            idleChecks = pool.getActiveCount() == 0 && pool.getQueueSize() == 0 ? idleChecks + 1 : 0;
            if (System.currentTimeMillis() > deadline) {
                throw new IllegalStateException("emailTaskExecutor still busy after 10s: active="
                        + pool.getActiveCount() + " queued=" + pool.getQueueSize());
            }
            try {
                Thread.sleep(10);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException(e);
            }
        }
    }
}
