package com.worktrac.backend.user;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.worktrac.backend.email.EmailService;
import com.worktrac.backend.support.AbstractIntegrationTest;
import com.worktrac.backend.support.RegistrationTestSupport;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import java.util.Map;
import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The narrowest login bucket: attempts against ONE address, from anywhere.
 *
 * <p>It exists because a per-IP bound alone bounds guessing badly — an attacker on sixty source
 * IPs got sixty times the budget against a single account. Splitting the two lets the per-IP
 * bucket be sized for load (and RAISED, since several member logins behind one home NAT can
 * legitimately reach the old 60) while this one is sized for guessing.
 *
 * <p>⚠️ <b>The enumeration property is the reason this class exists</b>, not the counting. Getting
 * the limit slightly wrong is a tuning question; consuming the bucket only for addresses that have
 * an account would make "which addresses eventually 429" a user-enumeration oracle, reintroducing
 * through the rate limiter exactly what {@code DUMMY_HASH} closed in the response body.
 */
@SpringBootTest(properties = {
        "app.rate-limit.login-per-email-per-hour=3",
        // Wide open, so nothing below can be refused by a bucket other than the one under test.
        "app.rate-limit.login-per-ip-per-hour=100000",
        "app.rate-limit.login-global-per-hour=100000"
})
@AutoConfigureMockMvc
@DisplayName("the per-email login rate limit")
class LoginPerEmailRateLimitTest extends AbstractIntegrationTest {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, LoginPerEmailRateLimitTest.class);
    }

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private TestCodeCache testCodeCache;

    @MockitoBean
    private EmailService emailService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    /** A login attempt from a named source IP, so per-IP and per-email can be told apart. */
    private ResultActions attempt(String email, String fromIp) throws Exception {
        return mockMvc.perform(post("/api/auth/login")
                .header("X-Forwarded-For", fromIp)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(
                        Map.of("email", email, "password", "wrong-password"))));
    }

    private String unique(String label) {
        return label + "-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
    }

    /**
     * ⚠️ <b>THE ENUMERATION PROPERTY.</b> An address with no account must be throttled exactly like
     * one with an account — same count, same status, same message. If the bucket were consumed only
     * for known emails, an attacker could tell registered addresses from unregistered ones by which
     * ones eventually 429, through a route needing no password at all.
     *
     * <p>Asserted as an equivalence rather than as two separate counts on purpose: what matters is
     * that the two are INDISTINGUISHABLE, not that either has a particular limit.
     */
    @Test
    void throttlesAnUnknownAddressExactlyLikeARegisteredOne() throws Exception {
        String registered = unique("known");
        RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache, registered, "Nate");
        String neverSeen = unique("unknown");

        // Three attempts each: allowed (401 -- wrong password), then refused identically.
        for (int i = 0; i < 3; i++) {
            attempt(registered, "10.1.0.1").andExpect(status().isUnauthorized());
            attempt(neverSeen, "10.1.0.2").andExpect(status().isUnauthorized());
        }

        attempt(registered, "10.1.0.1").andExpect(status().isTooManyRequests());
        attempt(neverSeen, "10.1.0.2").andExpect(status().isTooManyRequests());
    }

    /**
     * ⚠️ Per EMAIL, not per IP — the whole point. Rotating source addresses must not buy more
     * attempts against one account, which is the shape the old per-IP-only bound was blind to.
     */
    @Test
    void aRotatingAttackerGetsNoMoreAttemptsAgainstOneAccount() throws Exception {
        String target = unique("target");

        attempt(target, "10.2.0.1").andExpect(status().isUnauthorized());
        attempt(target, "10.2.0.2").andExpect(status().isUnauthorized());
        attempt(target, "10.2.0.3").andExpect(status().isUnauthorized());

        // A fourth source IP buys nothing: the budget belongs to the address being guessed at.
        attempt(target, "10.2.0.4").andExpect(status().isTooManyRequests());
    }

    // ...and it is genuinely per-address, so throttling one person never locks out another. A
    // household shares an IP, so a bucket that spilled across addresses would take the whole family
    // down when one member fat-fingered their password.
    @Test
    void oneAddressBeingThrottledDoesNotAffectAnother() throws Exception {
        String noisy = unique("noisy");
        String quiet = unique("quiet");

        for (int i = 0; i < 3; i++) {
            attempt(noisy, "10.3.0.1").andExpect(status().isUnauthorized());
        }
        attempt(noisy, "10.3.0.1").andExpect(status().isTooManyRequests());

        // Same IP, different address, still fine.
        attempt(quiet, "10.3.0.1").andExpect(status().isUnauthorized());
    }

    /**
     * ⚠️ Keyed on the NORMALISED address, matching the lookup. Without this, varying only the case
     * gives an attacker a fresh budget per spelling — a bypass, not a nicety, and one that would
     * pass every other test in this class.
     */
    @Test
    void casingVariantsShareOneBudget() throws Exception {
        String email = unique("mixedcase");

        attempt(email.toUpperCase(), "10.4.0.1").andExpect(status().isUnauthorized());
        attempt(email, "10.4.0.1").andExpect(status().isUnauthorized());
        attempt(email.substring(0, 1).toUpperCase() + email.substring(1), "10.4.0.1")
                .andExpect(status().isUnauthorized());

        attempt(email, "10.4.0.1").andExpect(status().isTooManyRequests());
    }

    /**
     * The refusal must not name an account or differ by whether one exists — a 429 that said "no
     * such account" would hand back through the error what the bucket ordering was built to hide.
     */
    @Test
    void theRefusalRevealsNothingAboutTheAddress() throws Exception {
        String neverSeen = unique("silent");

        for (int i = 0; i < 3; i++) {
            attempt(neverSeen, "10.5.0.1");
        }
        attempt(neverSeen, "10.5.0.1")
                .andExpect(status().isTooManyRequests())
                .andExpect(result -> {
                    String body = result.getResponse().getContentAsString();
                    if (body.toLowerCase().contains("account") || body.contains(neverSeen)) {
                        throw new AssertionError(
                                "The 429 body leaks something about the address: " + body);
                    }
                });
    }
}
