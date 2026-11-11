package com.worktrac.backend.identity;

import com.worktrac.backend.common.ServiceUnavailableException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * Apple's server-to-server notifications for Sign in with Apple. The URL is registered in the
 * Apple Developer portal against our Services ID.
 *
 * <p>{@code permitAll} in SecurityConfig, like the Stripe and email-delivery webhooks: Apple has
 * no session. It is authenticated instead by the notification itself, a JWT signed with Apple's
 * keys and addressed to our client id, which {@link IdTokenVerifier#verifyAppleNotification}
 * checks before anything is read from it. {@code HandlerPermissionCoverageTest} exempts this class
 * for that reason.
 *
 * <p>404 where Apple is not configured, the same answer as a route that does not exist. A bad
 * payload is a 400, logged with the reason; 503 when Apple's keys cannot be fetched, so Apple
 * retries rather than giving up.
 */
@RestController
public class AppleNotificationController {

    private static final Logger log = LoggerFactory.getLogger(AppleNotificationController.class);

    private final IdTokenVerifier verifier;
    private final AppleNotificationService notificationService;

    public AppleNotificationController(IdTokenVerifier verifier, AppleNotificationService notificationService) {
        this.verifier = verifier;
        this.notificationService = notificationService;
    }

    @PostMapping("/api/webhooks/apple-sign-in")
    public ResponseEntity<Void> receive(@RequestBody(required = false) NotificationBody body) {
        if (!verifier.isConfigured(IdentityProvider.APPLE)) {
            return ResponseEntity.notFound().build();
        }
        Jwt notification;
        try {
            notification = verifier.verifyAppleNotification(body == null ? null : body.payload());
        } catch (InvalidIdTokenException e) {
            log.warn("Refused an Apple notification: {}", e.getMessage());
            return ResponseEntity.badRequest().build();
        } catch (ProviderUnreachableException e) {
            throw new ServiceUnavailableException("Couldn't fetch Apple's keys to check this notification");
        }
        notificationService.handle(notification);
        return ResponseEntity.ok().build();
    }

    public record NotificationBody(String payload) {
    }
}
