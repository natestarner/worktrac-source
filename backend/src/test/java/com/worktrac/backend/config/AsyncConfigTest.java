package com.worktrac.backend.config;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

// Regression test for the async-email-dispatch blackhole: a saturated emailTaskExecutor must
// never silently drop a task the way the default AbortPolicy would.
class AsyncConfigTest {

    private ThreadPoolTaskExecutor executor;

    @AfterEach
    void tearDown() {
        if (executor != null) {
            executor.shutdown();
        }
    }

    @Test
    void usesCallerRunsPolicyNotTheSilentlyDroppingDefault() {
        executor = (ThreadPoolTaskExecutor) new AsyncConfig().emailTaskExecutor();

        assertInstanceOf(ThreadPoolExecutor.CallerRunsPolicy.class,
                executor.getThreadPoolExecutor().getRejectedExecutionHandler());
    }

    // Uses a small, deterministic executor configured the same way as AsyncConfig's real bean
    // (CallerRunsPolicy) rather than that bean's own tuned capacity, so saturation can be forced
    // quickly and reliably -- the real bean's own policy/capacity values are covered by
    // usesCallerRunsPolicyNotTheSilentlyDroppingDefault above.
    @Test
    void noTaskIsSilentlyDroppedWhenPoolAndQueueAreBothSaturated() throws InterruptedException {
        ThreadPoolTaskExecutor small = new ThreadPoolTaskExecutor();
        small.setCorePoolSize(1);
        small.setMaxPoolSize(2);
        small.setQueueCapacity(2);
        small.setRejectedExecutionHandler(new ThreadPoolExecutor.CallerRunsPolicy());
        small.initialize();
        executor = small;

        int admittedWithoutRejection = 4; // maxPoolSize(2) + queueCapacity(2)
        int overflow = 6; // guaranteed to be rejected by the pool and handled by the policy

        CountDownLatch releaseFillers = new CountDownLatch(1);
        CountDownLatch fillersRunning = new CountDownLatch(2); // one per maxPoolSize thread
        AtomicInteger completed = new AtomicInteger();
        CountDownLatch allDone = new CountDownLatch(admittedWithoutRejection + overflow);

        // Occupy every pool thread and fill the entire queue with tasks that block until
        // released, so the executor is guaranteed to be fully saturated for the next step.
        for (int i = 0; i < admittedWithoutRejection; i++) {
            executor.execute(() -> {
                fillersRunning.countDown();
                try {
                    releaseFillers.await(10, TimeUnit.SECONDS);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
                completed.incrementAndGet();
                allDone.countDown();
            });
        }
        assertTrue(fillersRunning.await(5, TimeUnit.SECONDS), "both pool threads should be occupied");

        // These would previously vanish under the default AbortPolicy. Each completes
        // immediately once it runs, whether that ends up being on a pool thread once one frees
        // up, or -- under CallerRunsPolicy -- synchronously on this submitting thread right now.
        for (int i = 0; i < overflow; i++) {
            executor.execute(() -> {
                completed.incrementAndGet();
                allDone.countDown();
            });
        }

        releaseFillers.countDown();

        assertTrue(allDone.await(10, TimeUnit.SECONDS),
                "every task must eventually run, even when submitted far beyond pool+queue capacity");
        assertEquals(admittedWithoutRejection + overflow, completed.get());
    }
}
