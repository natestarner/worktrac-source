package com.worktrac.backend.membership;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.config.BeanDefinition;
import org.springframework.context.annotation.ClassPathScanningCandidateComponentProvider;
import org.springframework.core.annotation.AnnotatedElementUtils;
import org.springframework.core.type.filter.AnnotationTypeFilter;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

// Fails the build when an endpoint is added without anyone deciding, in writing, who may call it.
//
// This is the half of the authorization model that cannot be enforced by code review alone. The
// dangerous failure is not a wrong permission -- that shows up the first time someone tries the
// feature -- it is a MISSING one, which is invisible: the endpoint works, for everyone, forever.
//
// Deliberately a plain classpath scan rather than a @SpringBootTest reading
// RequestMappingHandlerMapping. It needs no application context, no datasource and no container,
// so it runs in the fast unit tier where a build-gating test belongs, and it cannot be made to
// pass by mocking something out.
class HandlerPermissionCoverageTest {

    private static final String BASE_PACKAGE = "com.worktrac.backend";

    // Gated by a different mechanism entirely, and each one is a deliberate decision:
    //
    //   AuthController                 -- /api/auth/** is permitAll in SecurityConfig (register,
    //                                     login, the code flows). /me is the bootstrap call every
    //                                     member needs before any account context exists to check.
    //   StripeWebhookController        -- permitAll, authenticated by Stripe's signature.
    //   EmailDeliveryWebhookController -- permitAll, authenticated by a shared-secret query param.
    //   AdminController                -- /api/admin/** is hasRole("ADMIN") at the filter chain,
    //                                     and is the one deliberate cross-account reader.
    //   TestDataAdminController        -- @Profile({"local","lower"}); the bean does not exist in
    //   TestSupportController             production at all, which is the real safety net.
    //
    // ⚠️ Adding a name here removes an endpoint from the only mechanical guarantee the app has
    // that someone chose its authorization. Do it only for a route gated by something else, and
    // say what that something else is.
    private static final Set<String> EXEMPT_CONTROLLERS = Set.of(
            "AuthController",
            "StripeWebhookController",
            "EmailDeliveryWebhookController",
            "AdminController",
            "TestDataAdminController",
            "TestSupportController");

    @Test
    void everyApiHandlerDeclaresItsPermissions() throws Exception {
        List<String> undeclared = new ArrayList<>();

        for (Class<?> controller : restControllers()) {
            if (EXEMPT_CONTROLLERS.contains(controller.getSimpleName())) {
                continue;
            }
            for (Method method : controller.getDeclaredMethods()) {
                if (!isHandler(method)) {
                    continue;
                }
                if (!method.isAnnotationPresent(RequiresPermission.class)) {
                    undeclared.add(controller.getSimpleName() + "#" + method.getName());
                }
            }
        }

        assertThat(undeclared)
                .describedAs("Every /api handler must carry @RequiresPermission. Add the annotation "
                        + "declaring who may call it -- Permission.X for a household-scoped check, "
                        + "personScoped = true if a PersonService guard does it, or anyMember = true "
                        + "if any member of the account may.")
                .isEmpty();
    }

    // An annotation that declares nothing reads exactly like one that declares something, and
    // would sail past the test above while granting the endpoint to everyone.
    @Test
    void noHandlerDeclaresAnEmptyPermission() throws Exception {
        List<String> empty = new ArrayList<>();

        for (Class<?> controller : restControllers()) {
            for (Method method : controller.getDeclaredMethods()) {
                RequiresPermission required = method.getAnnotation(RequiresPermission.class);
                if (required == null) {
                    continue;
                }
                if (required.value().length == 0 && !required.personScoped() && !required.anyMember()) {
                    empty.add(controller.getSimpleName() + "#" + method.getName());
                }
            }
        }

        assertThat(empty)
                .describedAs("@RequiresPermission must declare something: a Permission, "
                        + "personScoped = true, or anyMember = true.")
                .isEmpty();
    }

    // anyMember means "nothing further to check". Combining it with a real requirement is a
    // contradiction, and the interceptor would honour the requirement while the source reads as
    // though the endpoint were open -- the worst of both.
    @Test
    void anyMemberIsNeverCombinedWithAnotherRequirement() throws Exception {
        List<String> contradictory = new ArrayList<>();

        for (Class<?> controller : restControllers()) {
            for (Method method : controller.getDeclaredMethods()) {
                RequiresPermission required = method.getAnnotation(RequiresPermission.class);
                if (required == null || !required.anyMember()) {
                    continue;
                }
                if (required.value().length > 0 || required.personScoped()) {
                    contradictory.add(controller.getSimpleName() + "#" + method.getName());
                }
            }
        }

        assertThat(contradictory)
                .describedAs("anyMember = true means no further check; it cannot be combined with "
                        + "a Permission or personScoped.")
                .isEmpty();
    }

    // A mutating handler whose ONLY declaration is a read permission is almost certainly a
    // copy-paste of the read endpoint beside it.
    @Test
    void noMutatingHandlerIsGatedOnlyByAReadPermission() throws Exception {
        List<String> suspicious = new ArrayList<>();

        for (Class<?> controller : restControllers()) {
            for (Method method : controller.getDeclaredMethods()) {
                RequiresPermission required = method.getAnnotation(RequiresPermission.class);
                if (required == null || !isMutating(method) || required.personScoped()) {
                    continue;
                }
                List<Permission> declared = List.of(required.value());
                if (!declared.isEmpty() && declared.stream().allMatch(HandlerPermissionCoverageTest::isReadOnly)) {
                    suspicious.add(controller.getSimpleName() + "#" + method.getName());
                }
            }
        }

        assertThat(suspicious)
                .describedAs("A POST/PUT/PATCH/DELETE handler declaring only a VIEW_* permission is "
                        + "gated on a read. Declare the write permission it actually needs.")
                .isEmpty();
    }

    private static boolean isReadOnly(Permission permission) {
        return permission == Permission.VIEW_OWN_PERSON || permission == Permission.VIEW_OTHER_PEOPLE;
    }

    private static boolean isHandler(Method method) {
        return Modifier.isPublic(method.getModifiers())
                && !method.isSynthetic()
                && AnnotatedElementUtils.hasAnnotation(method, RequestMapping.class);
    }

    private static boolean isMutating(Method method) {
        RequestMapping mapping = AnnotatedElementUtils.findMergedAnnotation(method, RequestMapping.class);
        if (mapping == null) {
            return false;
        }
        return List.of(mapping.method()).stream().anyMatch(m -> switch (m) {
            case POST, PUT, PATCH, DELETE -> true;
            default -> false;
        });
    }

    private static List<Class<?>> restControllers() throws ClassNotFoundException {
        ClassPathScanningCandidateComponentProvider scanner =
                new ClassPathScanningCandidateComponentProvider(false);
        scanner.addIncludeFilter(new AnnotationTypeFilter(RestController.class));

        List<Class<?>> controllers = new ArrayList<>();
        for (BeanDefinition definition : scanner.findCandidateComponents(BASE_PACKAGE)) {
            controllers.add(Class.forName(definition.getBeanClassName()));
        }
        // A scan that silently finds nothing would make every assertion above vacuous.
        assertThat(controllers).hasSizeGreaterThan(10);
        return controllers;
    }
}
