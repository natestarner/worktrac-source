package com.worktrac.backend.config;

import com.worktrac.backend.security.AuthRequestLoggingFilter;
import com.worktrac.backend.security.JwtAuthenticationFilter;
import com.worktrac.backend.security.JwtService;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfigurationSource;

@Configuration
@EnableWebSecurity
public class SecurityConfig {

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http, JwtService jwtService,
                                                     CorsConfigurationSource corsConfigurationSource) throws Exception {
        http
                .cors(cors -> cors.configurationSource(corsConfigurationSource))
                // CSRF protection defends session-cookie auth from forged cross-site requests
                // the browser auto-attaches cookies to. This API is stateless and auth-by-Bearer-
                // JWT only (read from localStorage by the frontend, never a cookie), so there is
                // no ambient credential for a forged request to ride on -- CSRF does not apply.
                // lgtm[java/spring-disabled-csrf-protection]
                .csrf(csrf -> csrf.disable())
                .sessionManagement(sm -> sm.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers("/api/auth/register", "/api/auth/login", "/api/auth/confirm-email",
                                "/api/auth/resend-code", "/api/auth/forgot-password", "/api/auth/reset-password",
                                "/api/auth/resend-reset-code", "/api/auth/test/pending-code").permitAll()
                        .requestMatchers("/actuator/health").permitAll()
                        .requestMatchers("/api/admin/**").hasRole("ADMIN")
                        .anyRequest().authenticated())
                // setStatus, not sendError: sendError triggers the servlet container's internal
                // forward to /error, which re-runs the whole security filter chain for that
                // forwarded dispatch -- and since this app is stateless (no session-persisted
                // SecurityContext), that second pass sees an anonymous principal, not the
                // original JWT auth. For a plain 401 that's invisible (anonymous -> still 401),
                // but for accessDeniedHandler's 403 case the forwarded, now-anonymous request
                // fails .anyRequest().authenticated() and gets sent to the entry point instead,
                // silently downgrading every real 403 into a 401 (confirmed live: MockMvc never
                // catches this since it doesn't perform a real container-level error dispatch).
                .exceptionHandling(e -> e
                        .authenticationEntryPoint((request, response, authException) -> response.setStatus(401))
                        .accessDeniedHandler((request, response, deniedException) -> response.setStatus(403)))
                // Order matters here: addFilterBefore resolves each filter's position
                // imperatively as this chain executes, so JwtAuthenticationFilter must be given
                // a registered order (relative to the standard UsernamePasswordAuthenticationFilter)
                // before anything can be positioned relative to it -- registering
                // AuthRequestLoggingFilter first would throw "does not have a registered order"
                // (confirmed by a real BeanCreationException without this ordering).
                .addFilterBefore(new JwtAuthenticationFilter(jwtService), UsernamePasswordAuthenticationFilter.class)
                .addFilterBefore(new AuthRequestLoggingFilter(), JwtAuthenticationFilter.class);
        return http.build();
    }
}
