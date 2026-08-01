package com.worktrac.backend.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

// Enables @Scheduled methods app-wide -- currently just RegistrationDispatchWatchdog's periodic
// reconciliation check.
@Configuration
@EnableScheduling
public class SchedulingConfig {
}
