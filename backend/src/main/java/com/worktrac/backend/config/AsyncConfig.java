package com.worktrac.backend.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.util.concurrent.Executor;

// Backs @Async methods (currently just RegistrationEmailEventListener) with a small dedicated
// pool, rather than the default SimpleAsyncTaskExecutor (unbounded, one new thread per task) --
// email sends are infrequent and low-volume enough that a small bounded pool is plenty, and
// bounding it caps how many concurrent Azure Communication Services calls one instance can have
// in flight.
@Configuration
@EnableAsync
public class AsyncConfig {

    @Bean
    Executor emailTaskExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(2);
        executor.setMaxPoolSize(4);
        executor.setQueueCapacity(50);
        executor.setThreadNamePrefix("email-async-");
        executor.initialize();
        return executor;
    }
}
