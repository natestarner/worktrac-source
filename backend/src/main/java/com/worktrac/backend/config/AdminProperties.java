package com.worktrac.backend.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

// The real source of truth for "who is an admin" -- ADMIN_EMAILS is set per-environment
// in the deploy repo's Container App env vars, not edited in the database. The `role`
// column on User is just a cache reconciled from this list (see AuthService.login and
// AdminBootstrap).
@Component
@ConfigurationProperties(prefix = "app.admin")
public class AdminProperties {

    private List<String> emails = List.of();

    public List<String> getEmails() {
        return emails;
    }

    public void setEmails(List<String> emails) {
        this.emails = emails;
    }

    public boolean isAdminEmail(String email) {
        return emails.contains(email.toLowerCase());
    }

    public Set<String> normalizedEmails() {
        return emails.stream().map(String::toLowerCase).collect(Collectors.toSet());
    }
}
