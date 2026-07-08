package com.worktrac.backend.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.util.Arrays;
import java.util.List;

// The one source of truth for CORS (never add @CrossOrigin to individual controllers).
// Exposed as a CorsConfigurationSource bean -- rather than the WebMvcConfigurer
// addCorsMappings approach -- because Spring Security's filter chain intercepts
// requests (including preflight OPTIONS) before Spring MVC's own CORS handling would
// ever run; SecurityConfig wires this same bean into http.cors(...) so both layers
// share one definition.
@Configuration
public class CorsConfig {

    @Value("${app.cors.allowed-origins}")
    private String allowedOrigins;

    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration configuration = new CorsConfiguration();
        configuration.setAllowedOrigins(Arrays.asList(allowedOrigins.split(",")));
        configuration.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"));
        configuration.setAllowedHeaders(List.of("*"));
        // Content-Disposition isn't in the CORS-safelisted response headers (Fetch spec),
        // so a cross-origin fetch can't read it off the response unless it's explicitly
        // exposed here -- without this, downloadPersonCsv (frontend/src/api/export.js)
        // silently falls back to a generic filename instead of the server-generated
        // "<Person>-workout-data-<date>.csv". Same-origin requests (local dev, behind the
        // Vite proxy) never hit this restriction, which is why it only surfaces once
        // frontend and backend are on genuinely different deployed origins.
        configuration.setExposedHeaders(List.of("Content-Disposition"));
        configuration.setAllowCredentials(true);
        configuration.setMaxAge(3600L);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/api/**", configuration);
        return source;
    }
}
