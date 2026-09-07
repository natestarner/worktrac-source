package com.worktrac.backend.membership;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Declares what a handler requires of the caller's membership. Enforced by PermissionInterceptor
 * for household-scoped permissions, and by PersonService's guards for person-scoped ones.
 *
 * <p><b>Every handler under /api/** must carry this</b>, and HandlerPermissionCoverageTest fails
 * the build otherwise. That is the point: a new endpoint cannot be added without someone deciding,
 * in writing, who may call it. "I forgot" produces a red build rather than an open door.
 *
 * <p>Exempt, because they are gated by a different mechanism entirely and the test knows it:
 * the permitAll /api/auth/** routes, /api/webhooks/**, /api/admin/** (SecurityConfig's
 * hasRole("ADMIN")) and the profile-gated /api/auth/test/** support routes.
 *
 * <p>Exactly one shape per handler:
 * <pre>
 *   &#64;RequiresPermission(Permission.MANAGE_PEOPLE)   // household-scoped; interceptor enforces
 *   &#64;RequiresPermission(personScoped = true)        // the service calls a PersonService guard
 *   &#64;RequiresPermission(anyMember = true)           // any authenticated member of the account
 * </pre>
 * value() and personScoped() may be combined -- CSV import is both IMPORT_DATA and person-scoped.
 * anyMember() may not be combined with either; it means "nothing further to check".
 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface RequiresPermission {

    /**
     * Household-scoped permissions the caller must hold. Checked by PermissionInterceptor before
     * the handler runs. All listed permissions are required (AND, not OR).
     */
    Permission[] value() default {};

    /**
     * True when this handler's real authorization happens inside the service, via
     * PersonService.requireVisiblePerson / requireWritablePerson.
     *
     * <p>An interceptor structurally cannot do this: it has no way to know which person a
     * {setId} or {sessionId} belongs to without loading the row. Declaring it here keeps those
     * handlers visible as a set, so "which endpoints defer their check?" is answerable by grep
     * rather than by reading every service.
     */
    boolean personScoped() default false;

    /**
     * True when any authenticated member of the account may call this -- an account-shared read
     * such as the exercise catalog, or a write whose only scoping is the account itself.
     *
     * <p>Deliberately explicit rather than being the default of an empty annotation: "nobody
     * decided" and "someone decided anyone may" must not look the same in the source.
     */
    boolean anyMember() default false;
}
