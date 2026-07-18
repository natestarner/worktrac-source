package com.worktrac.backend.admin;

import com.worktrac.backend.config.AdminProperties;
import com.worktrac.backend.user.User;
import com.worktrac.backend.user.UserRepository;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

// Promotes any already-registered user whose email is in ADMIN_EMAILS at startup, so a
// freshly deployed environment (or one where ADMIN_EMAILS was just added) doesn't require
// the admin to log out and back in before the role reconcile in AuthService.login runs.
// Login remains the ongoing source of truth after this -- this only covers the first
// deploy/config-change gap.
@Component
public class AdminBootstrap implements ApplicationRunner {

    private static final String ROLE_ADMIN = "ADMIN";

    private final UserRepository userRepository;
    private final AdminProperties adminProperties;

    public AdminBootstrap(UserRepository userRepository, AdminProperties adminProperties) {
        this.userRepository = userRepository;
        this.adminProperties = adminProperties;
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        for (String email : adminProperties.normalizedEmails()) {
            userRepository.findByEmail(email).ifPresent(this::promoteIfNeeded);
        }
    }

    private void promoteIfNeeded(User user) {
        if (!ROLE_ADMIN.equals(user.getRole())) {
            user.setRole(ROLE_ADMIN);
            userRepository.save(user);
        }
    }
}
