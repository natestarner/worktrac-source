package com.worktrac.backend.admin;

import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;

import static org.junit.jupiter.api.Assertions.assertEquals;

// Verifies the test-data cleanup endpoints' @Profile restriction actually works -- in isolation
// from the full app (no Testcontainers/DB/JWT secret needed), mirroring
// TestSupportControllerProfileTest's approach for the identical class of concern: this is purely
// about whether Spring registers the bean at all under a given profile, since that's the real
// safety net against ever running this in production (see TestDataAdminController's own
// comment), not just something to verify behaviorally once the route exists.
class TestDataAdminControllerProfileTest {

    @Test
    void beanExistsUnderLocalProfile() {
        try (AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext()) {
            context.getEnvironment().setActiveProfiles("local");
            context.register(TestDataAdminController.class, TestDataCleanupService.class);
            registerMockRepositories(context);
            context.refresh();

            assertEquals(1, context.getBeanNamesForType(TestDataAdminController.class).length);
        }
    }

    @Test
    void beanExistsUnderLowerProfile() {
        try (AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext()) {
            context.getEnvironment().setActiveProfiles("lower");
            context.register(TestDataAdminController.class, TestDataCleanupService.class);
            registerMockRepositories(context);
            context.refresh();

            assertEquals(1, context.getBeanNamesForType(TestDataAdminController.class).length);
        }
    }

    @Test
    void beanDoesNotExistUnderProductionProfile() {
        try (AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext()) {
            context.getEnvironment().setActiveProfiles("production");
            context.register(TestDataAdminController.class, TestDataCleanupService.class);
            registerMockRepositories(context);
            context.refresh();

            assertEquals(0, context.getBeanNamesForType(TestDataAdminController.class).length);
        }
    }

    // TestDataCleanupService (not @Profile-gated itself -- only the controller is) still needs
    // its own dependencies satisfied for the context to refresh at all; this test only cares
    // about the controller's registration, so plain Mockito mocks are enough.
    private void registerMockRepositories(AnnotationConfigApplicationContext context) {
        context.registerBean(com.worktrac.backend.user.UserRepository.class,
                () -> org.mockito.Mockito.mock(com.worktrac.backend.user.UserRepository.class));
        context.registerBean(com.worktrac.backend.person.PersonRepository.class,
                () -> org.mockito.Mockito.mock(com.worktrac.backend.person.PersonRepository.class));
        context.registerBean(com.worktrac.backend.exercise.ExerciseRepository.class,
                () -> org.mockito.Mockito.mock(com.worktrac.backend.exercise.ExerciseRepository.class));
        context.registerBean(com.worktrac.backend.tag.TagRepository.class,
                () -> org.mockito.Mockito.mock(com.worktrac.backend.tag.TagRepository.class));
        context.registerBean(com.worktrac.backend.account.AccountRepository.class,
                () -> org.mockito.Mockito.mock(com.worktrac.backend.account.AccountRepository.class));
        context.registerBean(com.worktrac.backend.registrationaudit.RegistrationEventRepository.class,
                () -> org.mockito.Mockito.mock(com.worktrac.backend.registrationaudit.RegistrationEventRepository.class));
        context.registerBean(com.worktrac.backend.user.PendingRegistrationRepository.class,
                () -> org.mockito.Mockito.mock(com.worktrac.backend.user.PendingRegistrationRepository.class));
        context.registerBean(com.worktrac.backend.contact.ContactMessageRepository.class,
                () -> org.mockito.Mockito.mock(com.worktrac.backend.contact.ContactMessageRepository.class));
        context.registerBean(com.worktrac.backend.csvimport.ImportBatchCleanup.class,
                () -> org.mockito.Mockito.mock(com.worktrac.backend.csvimport.ImportBatchCleanup.class));
    }
}
