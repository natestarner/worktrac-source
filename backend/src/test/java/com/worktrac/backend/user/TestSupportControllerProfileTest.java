package com.worktrac.backend.user;

import com.worktrac.backend.config.EmailProperties;
import com.worktrac.backend.registrationaudit.RegistrationEventRepository;
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
            registerMockRegistrationEventRepository(context);
            context.refresh();

            assertEquals(1, context.getBeanNamesForType(TestSupportController.class).length);
        }
    }

    @Test
    void beanDoesNotExistUnderProductionProfile() {
        try (AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext()) {
            context.getEnvironment().setActiveProfiles("production");
            context.register(TestSupportController.class, TestCodeCache.class, EmailProperties.class);
            registerMockRegistrationEventRepository(context);
            context.refresh();

            assertEquals(0, context.getBeanNamesForType(TestSupportController.class).length);
            assertEquals(0, context.getBeanNamesForType(TestCodeCache.class).length);
        }
    }

    // TestSupportController (not @Profile-gated itself -- only relevant under local, where the
    // controller bean it's a dependency of actually gets constructed) still needs these
    // dependencies satisfied for the context to refresh at all; this test only cares about the
    // controller's registration, so plain Mockito mocks are enough.
    private void registerMockRegistrationEventRepository(AnnotationConfigApplicationContext context) {
        context.registerBean(RegistrationEventRepository.class,
                () -> org.mockito.Mockito.mock(RegistrationEventRepository.class));
        // Added with the e2e billing-plan route, which needs to resolve a household from an email
        // and set its plan.
        context.registerBean(UserRepository.class,
                () -> org.mockito.Mockito.mock(UserRepository.class));
        context.registerBean(com.worktrac.backend.billing.SubscriptionRepository.class,
                () -> org.mockito.Mockito.mock(com.worktrac.backend.billing.SubscriptionRepository.class));
        context.registerBean(com.worktrac.backend.billing.SubscriptionService.class,
                () -> org.mockito.Mockito.mock(com.worktrac.backend.billing.SubscriptionService.class));
    }
}
