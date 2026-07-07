package com.worktrac.backend.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.time.Clock;

// A single injectable Clock bean so time-dependent rules (e.g. WorkoutSessionService's
// 8-hour staleness window) can be exercised in tests without a real wait, by overriding
// this bean with a fixed/mutable Clock.
@Configuration
public class ClockConfig {

    @Bean
    public Clock clock() {
        return Clock.systemUTC();
    }
}
