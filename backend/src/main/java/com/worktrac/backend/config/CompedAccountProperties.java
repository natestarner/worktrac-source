package com.worktrac.backend.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

// The founding households that keep Pro for free. Set per-environment via COMPED_EMAILS, exactly
// the way ADMIN_EMAILS works -- and deliberately NOT as a Flyway migration, for two reasons:
//
//   1. These are other people's personal email addresses. A migration would write them into git
//      history permanently, in a repository that has no business holding them. An env var sourced
//      from a deploy secret keeps them out of both repositories.
//   2. Comping someone later would otherwise need a new migration each time. This makes it a
//      config change, which is what it actually is.
//
// Empty by default, so an environment that sets nothing simply has no comped households rather
// than failing or defaulting open -- the same posture as AdminProperties.
@Component
@ConfigurationProperties(prefix = "app.billing")
public class CompedAccountProperties {

    private List<String> compedEmails = List.of();

    public List<String> getCompedEmails() {
        return compedEmails;
    }

    public void setCompedEmails(List<String> compedEmails) {
        this.compedEmails = compedEmails;
    }

    public Set<String> normalizedCompedEmails() {
        return compedEmails.stream()
                .map(String::trim)
                .filter(email -> !email.isEmpty())
                .map(String::toLowerCase)
                .collect(Collectors.toSet());
    }
}
