package com.worktrac.backend.billing;

import com.worktrac.backend.config.CompedAccountProperties;
import com.worktrac.backend.user.User;
import com.worktrac.backend.user.UserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.Set;

// Grants Pro, free and permanently, to the founding households listed in COMPED_EMAILS -- the
// people who were using Huddle before it had a paid plan. Modelled directly on AdminBootstrap,
// which does the same job for ADMIN_EMAILS.
//
// PROMOTE-ONLY, and that asymmetry is deliberate. AdminBootstrap promotes at startup while
// AuthService.login both promotes and demotes, because losing an admin role costs someone a menu
// item. Losing a comp costs them their entire training history behind a paywall, with no warning
// and no purchase to point at -- far too consequential to happen as a side effect of someone
// editing an environment variable, or of a deploy where the secret was momentarily unset.
//
// So a household that drops off the list is LOGGED, not revoked. Un-comping stays a deliberate act.
@Component
public class CompBootstrap implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(CompBootstrap.class);

    private final UserRepository userRepository;
    private final SubscriptionRepository subscriptionRepository;
    private final SubscriptionService subscriptionService;
    private final CompedAccountProperties properties;

    public CompBootstrap(UserRepository userRepository, SubscriptionRepository subscriptionRepository,
                          SubscriptionService subscriptionService, CompedAccountProperties properties) {
        this.userRepository = userRepository;
        this.subscriptionRepository = subscriptionRepository;
        this.subscriptionService = subscriptionService;
        this.properties = properties;
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        Set<String> compedEmails = properties.normalizedCompedEmails();
        if (compedEmails.isEmpty()) {
            return;
        }

        int granted = 0;
        for (String email : compedEmails) {
            User user = userRepository.findByEmail(email).orElse(null);
            if (user == null) {
                // Not an error: a founding household that has not registered yet (or registered
                // under a different address) simply gets comped whenever they do, since this runs
                // on every startup.
                continue;
            }
            if (grantIfNeeded(user)) granted++;
        }

        if (granted > 0) {
            log.info("Comped {} founding household(s) on startup", granted);
        }
        warnAboutRevokedComps(compedEmails);
    }

    private boolean grantIfNeeded(User user) {
        Subscription subscription = subscriptionService.getOrCreate(user.getAccount());
        if (subscription.isComped()) {
            return false;
        }
        subscription.setComped(true);
        // plan is a materialized cache of the derivation, so it moves with it. isPro stays the
        // authority and already returns true for a comped household.
        subscription.setPlan(BillingPlan.PRO);
        subscriptionRepository.save(subscription);
        return true;
    }

    // A household comped in the database but no longer on the list is drift worth seeing. It is
    // NOT corrected here -- see the class comment for why silently revoking Pro is the one thing
    // this must never do.
    private void warnAboutRevokedComps(Set<String> compedEmails) {
        for (Subscription subscription : subscriptionRepository.findByCompedTrue()) {
            userRepository.findByAccount_Id(subscription.getAccount().getId())
                    .map(User::getEmail)
                    .filter(email -> !compedEmails.contains(email.toLowerCase()))
                    .ifPresent(email -> log.warn(
                            "Account {} is comped but no longer listed in COMPED_EMAILS."
                                    + " Left as-is; clear it deliberately if that is intended.",
                            subscription.getAccount().getId()));
        }
    }
}
