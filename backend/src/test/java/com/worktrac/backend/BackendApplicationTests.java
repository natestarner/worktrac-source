package com.worktrac.backend;

import com.worktrac.backend.email.EmailService;
import com.worktrac.backend.support.AbstractIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

// "local" is activated (by AbstractIntegrationTest) so app.jwt.secret resolves to the
// dev-only secret in application-local.yml (the JwtService bean eagerly builds its signing
// key at startup).
class BackendApplicationTests extends AbstractIntegrationTest {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, BackendApplicationTests.class);
    }

    // EmailService's real constructor builds a live Azure EmailClient from
    // app.email.connection-string, which is empty in the "local" test profile (no real ACS
    // resource in CI) -- @MockitoBean replaces the bean entirely so that constructor never
    // runs, instead of merely shadowing it the way a @Primary @TestConfiguration bean would.
    @MockitoBean
    private EmailService emailService;

    @Test
    void contextLoads() {
    }
}
