package com.worktrac.backend.membership;

import com.worktrac.backend.common.ForbiddenException;
import com.worktrac.backend.security.CurrentUser;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;

// Enforces @RequiresPermission's household-scoped half. Person-scoped handlers declare themselves
// and are enforced in the service, because an interceptor cannot know which person a {setId} is.
//
// ── WHY IT THROWS RATHER THAN WRITING A STATUS ────────────────────────────────────────────────
// Throwing ForbiddenException puts this on the one path GlobalExceptionHandler already owns, which
// answers with an honest 403 body. Calling response.setStatus/sendError here would be a second,
// parallel way to fail -- and sendError specifically re-dispatches to /error, which re-runs the
// stateless security chain as anonymous and silently downgrades the 403 into a 401. A 401 is read
// by the frontend as "session invalid" and logs the person out, so getting this wrong turns
// "you may not do that" into "you have been signed out". SecurityConfig's exceptionHandling uses
// setStatus over sendError for exactly this reason.
//
// ⚠️ MockMvc CANNOT prove that distinction: it performs no container-level error dispatch, so a
// 403 that would be downgraded in production still reads as 403 there. The guarantee is pinned by
// a Playwright assertion instead. See SecurityConfig's own comment on the same trap.
//
// ── VISIBILITY ────────────────────────────────────────────────────────────────────────────────
// Every denial logs at WARN with the permission, the account and the path. Those lines already
// carry `cid` and `uid` from RequestDiagnosticsFilter and JwtAuthenticationFilter, so a support
// report of "it says I can't do that" is traceable to the exact request without extra plumbing.
// Same reasoning as QuotaService: a refusal nobody can see is a support ticket waiting to happen.
public class PermissionInterceptor implements HandlerInterceptor {

    private static final Logger log = LoggerFactory.getLogger(PermissionInterceptor.class);

    /**
     * The one refusal in the app the CLIENT acts on rather than merely displays.
     *
     * <p>A 403 is normally definitive, so the durable outbox reports the write as one that can
     * never land. This one is the opposite: the household re-upgrades and the queued work lands by
     * itself on the next flush. {@code isDeadWrite} carves it out by this exact string, so it is a
     * contract with the frontend — {@code queryClient.test.js} pins it.
     */
    public static final String MEMBER_LOGIN_PAUSED = "MEMBER_LOGIN_PAUSED";

    private final CurrentUser currentUser;

    public PermissionInterceptor(CurrentUser currentUser) {
        this.currentUser = currentUser;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        if (!(handler instanceof HandlerMethod handlerMethod)) {
            return true;
        }
        RequiresPermission required = handlerMethod.getMethodAnnotation(RequiresPermission.class);
        // No annotation means the handler is not under this mechanism at all -- the permitAll auth
        // routes, the webhooks, and /api/admin/** (gated by hasRole at the filter chain). Handlers
        // that SHOULD carry one but don't are caught at build time by
        // HandlerPermissionCoverageTest, not silently allowed here.
        //
        // ⚠️ This early return checks only for the annotation's ABSENCE, deliberately. An
        // annotation with an empty value() is still under the mechanism -- personScoped and
        // anyMember both look like that -- and it still has an authenticated principal, so
        // currentUser.access() below is safe. The first cut returned early on
        // `required.value().length == 0` too, which silently exempted every person-scoped route
        // from the pause check: a paused member could still log sets, while /me correctly reported
        // them paused. Those are the routes that matter most here.
        if (required == null) {
            return true;
        }

        AccountAccess access = currentUser.access();

        // Asked BEFORE any permission, because it is a different question: not "may you do this"
        // but "may you do anything at all right now". See below for what stays open.
        if (access.status() == MembershipStatus.PAUSED_PLAN && !isAllowedWhilePaused(request)) {
            log.warn("Refused {} {} for account {} membership {}: member login paused (household is not Pro)",
                    request.getMethod(), request.getRequestURI(), access.accountId(), access.membershipId());
            throw new ForbiddenException(
                    "This login is paused because the household is no longer on Pro."
                            + " Nothing has been deleted — ask the household owner to upgrade.",
                    MEMBER_LOGIN_PAUSED);
        }

        // personScoped / anyMember: nothing household-scoped left to check here.
        if (required.value().length == 0) {
            return true;
        }

        for (Permission permission : required.value()) {
            if (!access.has(permission)) {
                log.warn("Refused {} {} for account {} membership {} role {}: missing {}",
                        request.getMethod(), request.getRequestURI(), access.accountId(),
                        access.membershipId(), access.accountRole(), permission);
                throw new ForbiddenException(deniedMessage(permission));
            }
        }
        return true;
    }

    /**
     * The two routes a paused login may still call.
     *
     * <p>⚠️ <b>An allow-list, not a deny-list, and it is deliberately two entries long.</b> A
     * deny-list would silently admit every route added later, which is precisely the class of
     * mistake a pause must not make — a member whose household stopped paying would keep whatever
     * the newest endpoint offers.
     *
     * <ul>
     *   <li><b>{@code GET /api/auth/me}</b> is the single authority on being paused. It keeps
     *   answering 200 so the client can render the paused screen from {@code membershipStatus}
     *   rather than inferring it from a stray 403 — which matters because the client cannot tell
     *   "paused" from "the backend is briefly unhappy" by status alone, and guessing wrong there
     *   is the signed-out failure {@code docs/incidents/2026-07-27-db-outage-forced-logout.md}
     *   describes. In practice it never even reaches here: {@code AuthController} carries no
     *   {@code @RequiresPermission}, so this method returns early above. It is named anyway,
     *   because the day somebody annotates that controller this stops being a coincidence.</li>
     *   <li><b>{@code GET /api/billing/subscription}</b> so the paused screen can say what plan the
     *   household is actually on. Without it the screen can state the problem but never confirm it
     *   is fixed.</li>
     * </ul>
     *
     * <p>Both are GETs. A paused login writes nothing, anywhere.
     */
    private boolean isAllowedWhilePaused(HttpServletRequest request) {
        if (!"GET".equals(request.getMethod())) {
            return false;
        }
        String path = request.getRequestURI();
        return "/api/auth/me".equals(path) || "/api/billing/subscription".equals(path);
    }

    // Says who CAN do it rather than only that the caller can't, because in every case here the
    // resolution is "ask the person who owns the household". A bare "forbidden" leaves someone
    // stuck; this tells them what to do next. It leaks nothing -- a member already knows their
    // household has an owner.
    private String deniedMessage(Permission permission) {
        return switch (permission) {
            case MANAGE_BILLING -> "Only the household owner can manage the plan.";
            case DELETE_ACCOUNT -> "Only the household owner can delete the account.";
            case MANAGE_PEOPLE -> "Only the household owner can add or remove people.";
            case MANAGE_LOGINS -> "Only the household owner can manage logins.";
            case MANAGE_HOUSEHOLD -> "Only the household owner can change household settings.";
            case IMPORT_DATA -> "Only the household owner can import workouts.";
            case EXPORT_ACCOUNT_DATA -> "Only the household owner can export the whole household.";
            case DELETE_SHARED_RESOURCE -> "Only the household owner can delete this.";
            case EDIT_ANY_SHARED_RESOURCE -> "You can only edit things you created.";
            default -> "You don't have permission to do that.";
        };
    }
}
