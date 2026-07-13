package com.worktrac.backend.user;

import com.worktrac.backend.config.EmailProperties;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;

import static org.junit.jupiter.api.Assertions.assertEquals;

// Verifies the test-support endpoint's @Profile restriction actually works -- in isolation
// from the full app (no Testcontainers/DB/JWT secret needed), since this is purely about
// whether Spring registers the bean at all under a given profile, not about the endpoint's
// behavior once it exists (that's covered by AuthControllerTest#testSupportEndpointRequiresMatchingKey).
class TestSupportControllerProfileTest {

    @Test
    void beanExistsUnderLocalProfile() {
        try (AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext()) {
            context.getEnvironment().setActiveProfiles("local");
            context.register(TestSupportController.class, TestCodeCache.class, EmailProperties.class);
            context.refresh();

            assertEquals(1, context.getBeanNamesForType(TestSupportController.class).length);
        }
    }

    @Test
    void beanDoesNotExistUnderProductionProfile() {
        try (AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext()) {
            context.getEnvironment().setActiveProfiles("production");
            context.register(TestSupportController.class, TestCodeCache.class, EmailProperties.class);
            context.refresh();

            assertEquals(0, context.getBeanNamesForType(TestSupportController.class).length);
            assertEquals(0, context.getBeanNamesForType(TestCodeCache.class).length);
        }
    }
}
