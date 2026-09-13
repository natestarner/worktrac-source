package com.worktrac.backend.config;

import com.worktrac.backend.membership.PermissionInterceptor;
import com.worktrac.backend.security.CurrentUser;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

// Registers PermissionInterceptor, which enforces the household-scoped half of
// @RequiresPermission.
//
// ⚠️ This is the first WebMvcConfigurer in the app, and it must stay narrow. CorsConfig
// deliberately exposes a CorsConfigurationSource bean INSTEAD of configuring CORS through a
// WebMvcConfigurer -- see its own comment. Do not "consolidate" the two: CORS is registered per
// path against the security filter chain, and moving it here would change when it applies
// relative to authentication.
@Configuration
public class WebMvcConfig implements WebMvcConfigurer {

    private final CurrentUser currentUser;

    public WebMvcConfig(CurrentUser currentUser) {
        this.currentUser = currentUser;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        // Scoped to /api/** rather than everything: /actuator/health is permitAll and has no
        // principal to resolve, and an interceptor that runs there is one more thing that can
        // fail on the endpoint the offline banner depends on.
        registry.addInterceptor(new PermissionInterceptor(currentUser)).addPathPatterns("/api/**");
    }
}
