package com.worktrac.backend.identity;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.worktrac.backend.membership.AccountAccessService;
import com.worktrac.backend.registrationaudit.RegistrationAuditService;
import com.worktrac.backend.registrationaudit.RegistrationEventType;
import com.worktrac.backend.user.User;
import com.worktrac.backend.user.UserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.IOException;
import java.util.Map;

/**
 * Acts on Apple's server-to-server notifications for Sign in with Apple.
 *
 * <ul>
 *   <li><b>consent-revoked</b> (the person stopped using their Apple ID with Huddle) and
 *       <b>account-delete</b> (they deleted their Apple ID): the Apple identity is disconnected and
 *       every session of that login ends ({@code token_version}), because an Apple ID the person
 *       has walked away from must not keep a way into Huddle open. The HOUSEHOLD is never touched:
 *       it may hold other people's training, and Apple speaks for one person's Apple ID only.</li>
 *   <li><b>email-disabled</b> / <b>email-enabled</b>: Hide My Email forwarding off / on. Recorded,
 *       so a "sent" email nobody received has an explanation in the admin Activity tab.</li>
 * </ul>
 *
 * <p>Idempotent: Apple retries, and a notification for an identity we do not have (already
 * disconnected, or never linked here) is acknowledged and ignored.
 */
@Service
public class AppleNotificationService {

    private static final Logger log = LoggerFactory.getLogger(AppleNotificationService.class);

    private final UserIdentityRepository identityRepository;
    private final UserRepository userRepository;
    private final AccountAccessService accountAccessService;
    private final RegistrationAuditService auditService;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public AppleNotificationService(UserIdentityRepository identityRepository, UserRepository userRepository,
                                    AccountAccessService accountAccessService,
                                    RegistrationAuditService auditService) {
        this.identityRepository = identityRepository;
        this.userRepository = userRepository;
        this.accountAccessService = accountAccessService;
        this.auditService = auditService;
    }

    /** @param notification a payload {@link IdTokenVerifier#verifyAppleNotification} has verified */
    @Transactional
    public void handle(Jwt notification) {
        JsonNode event = events(notification);
        String type = event.path("type").asText("");
        String subject = event.path("sub").asText("");
        if (subject.isBlank()) {
            log.warn("Apple notification of type '{}' carried no subject; ignored", type);
            return;
        }

        var identity = identityRepository.findByProviderAndSubject(IdentityProvider.APPLE, subject);
        if (identity.isEmpty()) {
            log.info("Apple notification '{}' for an Apple identity not linked here; ignored", type);
            return;
        }
        User user = identity.get().getUser();

        switch (type) {
            case "consent-revoked", "account-delete" -> {
                identityRepository.delete(identity.get());
                User locked = userRepository.findByIdForUpdate(user.getId()).orElseThrow();
                locked.bumpTokenVersion();
                userRepository.save(locked);
                accountAccessService.invalidateUser(locked.getId());
                long remaining = identityRepository.countByUser_Id(locked.getId()) - 1;
                boolean wayIn = locked.hasPassword() || remaining > 0;
                String detail = "Apple identity disconnected (" + type + "); "
                        + (wayIn ? "the login still has another way to sign in"
                                 : "the login now has NO way to sign in -- forgot-password to its email is the way back");
                log.warn("Apple {} for user {}: {}", type, locked.getId(), detail);
                auditService.record(locked.getEmail(), "account-delete".equals(type)
                        ? RegistrationEventType.APPLE_ACCOUNT_DELETED
                        : RegistrationEventType.APPLE_CONSENT_REVOKED, detail);
            }
            case "email-disabled" -> auditService.record(user.getEmail(), RegistrationEventType.APPLE_EMAIL_DISABLED,
                    "Hide My Email forwarding turned off for " + event.path("email").asText("this address")
                            + ": Apple will drop every email to it until it is turned back on");
            case "email-enabled" -> auditService.record(user.getEmail(), RegistrationEventType.APPLE_EMAIL_ENABLED,
                    "Hide My Email forwarding turned back on");
            default -> log.info("Apple notification of unknown type '{}' for user {}; ignored", type, user.getId());
        }
    }

    // Apple sends "events" as a JSON STRING inside the JWT, not as a nested object. Tolerate both.
    private JsonNode events(Jwt notification) {
        Object raw = notification.getClaims().get("events");
        try {
            if (raw instanceof String text) {
                return objectMapper.readTree(text);
            }
            if (raw instanceof Map<?, ?> map) {
                return objectMapper.valueToTree(map);
            }
        } catch (IOException e) {
            log.warn("Apple notification events could not be read: {}", e.getMessage());
        }
        return objectMapper.createObjectNode();
    }
}
