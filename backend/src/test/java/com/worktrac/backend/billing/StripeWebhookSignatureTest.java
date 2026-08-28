package com.worktrac.backend.billing;

import com.stripe.exception.SignatureVerificationException;
import com.worktrac.backend.config.StripeProperties;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

// The webhook route is permitAll -- Stripe is a server-to-server caller with no JWT -- so this
// signature check is the ONLY thing between it and the open internet. It therefore gets a test
// against the real cryptography rather than a mock: computing a genuine HMAC here proves the whole
// path, where a mocked StripeService would only prove that a stub returns what it was told to.
//
// A plain unit test: no Spring context, no container, no network. Stripe's verification is pure
// computation over the raw bytes and a shared secret.
class StripeWebhookSignatureTest {

    private static final String WEBHOOK_SECRET = "whsec_test_secret_for_signature_verification_only";
    private static final String PAYLOAD =
            "{\"id\":\"evt_test_1\",\"object\":\"event\",\"type\":\"customer.subscription.updated\","
                    + "\"data\":{\"object\":{\"id\":\"sub_test_1\",\"object\":\"subscription\"}}}";

    private StripeService stripeService;

    @BeforeEach
    void setUp() {
        StripeProperties properties = new StripeProperties();
        properties.setWebhookSecret(WEBHOOK_SECRET);
        stripeService = new StripeService(properties);
    }

    // Stripe's header format: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<payload>">.
    private static String signatureHeader(String payload, Instant timestamp, String secret) {
        long seconds = timestamp.getEpochSecond();
        String signedPayload = seconds + "." + payload;
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            String signature = HexFormat.of()
                    .formatHex(mac.doFinal(signedPayload.getBytes(StandardCharsets.UTF_8)));
            return "t=" + seconds + ",v1=" + signature;
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    @Test
    void acceptsAGenuineSignature() throws Exception {
        String header = signatureHeader(PAYLOAD, Instant.now(), WEBHOOK_SECRET);

        var event = stripeService.verifyWebhook(PAYLOAD, header);

        assertThat(event.getId()).isEqualTo("evt_test_1");
        assertThat(event.getType()).isEqualTo("customer.subscription.updated");
    }

    @Test
    void rejectsASignatureMadeWithTheWrongSecret() {
        String header = signatureHeader(PAYLOAD, Instant.now(), "whsec_some_other_secret_entirely");

        assertThatThrownBy(() -> stripeService.verifyWebhook(PAYLOAD, header))
                .isInstanceOf(SignatureVerificationException.class);
    }

    // The signature covers the payload, so an attacker who captured a real header cannot reuse it
    // to deliver different instructions -- e.g. the same event pointed at another subscription.
    @Test
    void rejectsATamperedBodyEvenWithAnOtherwiseValidSignature() {
        String header = signatureHeader(PAYLOAD, Instant.now(), WEBHOOK_SECRET);
        String tampered = PAYLOAD.replace("sub_test_1", "sub_someone_elses");

        assertThatThrownBy(() -> stripeService.verifyWebhook(tampered, header))
                .isInstanceOf(SignatureVerificationException.class);
    }

    // The timestamp tolerance IS the replay defence: a genuine header captured off the wire stops
    // working once it ages out. Stripe's default window is 5 minutes -- do not widen it.
    @Test
    void rejectsAGenuineSignatureThatIsTooOld() {
        Instant longAgo = Instant.now().minus(Duration.ofHours(2));
        String header = signatureHeader(PAYLOAD, longAgo, WEBHOOK_SECRET);

        assertThatThrownBy(() -> stripeService.verifyWebhook(PAYLOAD, header))
                .isInstanceOf(SignatureVerificationException.class);
    }

    @Test
    void rejectsAMalformedHeader() {
        assertThatThrownBy(() -> stripeService.verifyWebhook(PAYLOAD, "not-a-signature"))
                .isInstanceOf(SignatureVerificationException.class);
    }

    // An environment with no secret must reject rather than default open. StripeProperties returns
    // false from isWebhookConfigured, and the controller refuses before ever reaching this -- but
    // the crypto layer must not quietly accept an empty key either.
    @Test
    void rejectsWhenNoSecretIsConfigured() {
        StripeProperties unconfigured = new StripeProperties();
        StripeService service = new StripeService(unconfigured);
        String header = signatureHeader(PAYLOAD, Instant.now(), WEBHOOK_SECRET);

        assertThat(unconfigured.isWebhookConfigured()).isFalse();
        assertThatThrownBy(() -> service.verifyWebhook(PAYLOAD, header))
                .isInstanceOf(Exception.class);
    }
}
