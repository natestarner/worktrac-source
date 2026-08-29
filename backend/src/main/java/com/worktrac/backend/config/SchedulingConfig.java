package com.worktrac.backend.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

// Enables @Scheduled methods app-wide -- RegistrationDispatchWatchdog's periodic reconciliation
// check, and SubscriptionReconciliationWatchdog's hourly billing-drift sweep.
@Configuration
@EnableScheduling
public class SchedulingConfig {
}
