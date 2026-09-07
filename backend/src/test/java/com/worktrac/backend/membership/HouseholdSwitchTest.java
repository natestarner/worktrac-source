package com.worktrac.backend.membership;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.worktrac.backend.email.EmailService;
import com.worktrac.backend.support.AbstractIntegrationTest;
import com.worktrac.backend.support.RegistrationTestSupport;
import com.worktrac.backend.user.TestCodeCache;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * One login, two households — the account picker and "switch household".
 *
 * <p>The dangerous surface here is the <b>selection token</b>: a credential minted after a password
 * is proved but before a household is chosen. It has to be enough to finish the sign-in and useless
 * for anything else, and "useless for anything else" is not something a reader can verify by
 * looking at it — hence the tests below that try to use it as a session.
 */
@AutoConfigureMockMvc
class HouseholdSwitchTest extends AbstractIntegrationTest {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, HouseholdSwitchTest.class);
    }

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private TestCodeCache testCodeCache;

    @MockitoBean
    private EmailService emailService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private String sharedEmail;
    private String password;
    private long firstAccountId;
    private long secondAccountId;

    /**
     * One credential in two households. Built by registering household A, then having household B's
     * owner attach that same email as a MEMBER — the shape phase 7's invite flow will produce, done
     * directly here because that flow does not exist yet.
     */
    @BeforeEach
    void setUpOneLoginInTwoHouseholds() throws Exception {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        sharedEmail = "both-" + suffix + "@example.com";
        password = "password123";

        JsonNode first = RegistrationTestSupport
                .registerAndConfirm(mockMvc, objectMapper, testCodeCache, sharedEmail, "Alex");
        firstAccountId = first.get("account").get("id").asLong();

        String otherOwnerEmail = "owner-" + suffix + "@example.com";
        JsonNode second = RegistrationTestSupport
                .registerAndConfirm(mockMvc, objectMapper, testCodeCache, otherOwnerEmail, "Nate");
        secondAccountId = second.get("account").get("id").asLong();
        String otherOwnerToken = second.get("token").asText();

        mockMvc.perform(post("/api/people")
                        .header("Authorization", "Bearer " + otherOwnerToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("name", "Sam"))))
                .andExpect(status().isOk());

        mockMvc.perform(post("/api/auth/test/member")
                        .header("X-E2E-Test-Key", "local-dev-only-e2e-test-key-do-not-use-elsewhere")
                        .param("ownerEmail", otherOwnerEmail)
                        .param("personName", "Sam")
                        .param("memberEmail", sharedEmail)
                        .param("password", password))
                .andExpect(status().isNoContent());
    }

    private JsonNode json(ResultActions actions) throws Exception {
        return objectMapper.readTree(actions.andReturn().getResponse().getContentAsString());
    }

    private JsonNode login(String email) throws Exception {
        return json(mockMvc.perform(post("/api/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("email", email, "password", password))))
                .andExpect(status().isOk()));
    }

    @Test
    void twoHouseholdsReturnAPickerInsteadOfASession() throws Exception {
        JsonNode response = login(sharedEmail);

        // No session yet -- the client branches on exactly this.
        assertThat(response.get("token").isNull()).isTrue();
        assertThat(response.get("selectionToken").asText()).isNotBlank();
        assertThat(response.get("households")).hasSize(2);

        // The picker carries a label and a role, and deliberately nothing else: this is the one
        // response in the app that spans households.
        JsonNode choice = response.get("households").get(0);
        assertThat(choice.has("accountId")).isTrue();
        assertThat(choice.has("accountName")).isTrue();
        assertThat(choice.has("accountRole")).isTrue();
        assertThat(choice.has("plan")).isFalse();
    }

    // The overwhelmingly common path, and the one that must not have changed shape because a rare
    // one now exists.
    @Test
    void oneHouseholdStillSignsStraightIn() throws Exception {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        String soloEmail = "solo-" + suffix + "@example.com";
        RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache, soloEmail, "Casey");

        JsonNode response = login(soloEmail);

        assertThat(response.get("token").asText()).isNotBlank();
        assertThat(response.get("account").get("id").asLong()).isPositive();
        assertThat(response.get("membership").get("accountRole").asText()).isEqualTo("OWNER");
        assertThat(response.get("households").isNull()).isTrue();
        assertThat(response.get("selectionToken").isNull()).isTrue();
    }

    @Test
    void aSelectionTokenMintsASessionForAHouseholdTheyBelongTo() throws Exception {
        String selectionToken = login(sharedEmail).get("selectionToken").asText();

        JsonNode session = json(mockMvc.perform(post("/api/auth/session")
                .header("Authorization", "Bearer " + selectionToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("accountId", secondAccountId))))
                .andExpect(status().isOk()));

        assertThat(session.get("token").asText()).isNotBlank();
        assertThat(session.get("account").get("id").asLong()).isEqualTo(secondAccountId);
        assertThat(session.get("membership").get("accountRole").asText()).isEqualTo("MEMBER");
    }

    /**
     * ⚠️ THE ONE THAT MATTERS. A selection token proves who you are, never what you may do — so it
     * has to be refused by the ordinary filter everywhere.
     *
     * <p>Before the explicit {@code scp} check in {@code JwtService.parseToken}, this passed only
     * INCIDENTALLY: a selection token happens to carry no {@code accountId}, and the null guard
     * there rejected it. That made the security of this whole design rest on an absence, one
     * convenience field away from silently becoming a full thirty-day session.
     */
    @Test
    void aSelectionTokenIsNotASessionAnywhereElse() throws Exception {
        String selectionToken = login(sharedEmail).get("selectionToken").asText();

        mockMvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + selectionToken))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/exercises").header("Authorization", "Bearer " + selectionToken))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/people").header("Authorization", "Bearer " + selectionToken))
                .andExpect(status().isUnauthorized());
    }

    /**
     * The entire security of {@code /api/auth/session} is its membership lookup: no password is
     * involved on either path into it, so without that check any signed-in person could mint a
     * token for any account id they typed.
     *
     * <p>404 rather than 403, deliberately. A household you are not in is not something you are
     * entitled to distinguish from one that does not exist — a 403 would confirm the account id is
     * real, which is an enumeration oracle spanning households. Same non-distinguishing shape
     * {@code PersonService.requireVisiblePerson} uses one boundary in.
     */
    @Test
    void aSessionCannotBeMintedForAHouseholdYouAreNotIn() throws Exception {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        String strangerEmail = "stranger-" + suffix + "@example.com";
        String strangerToken = RegistrationTestSupport
                .registerAndConfirm(mockMvc, objectMapper, testCodeCache, strangerEmail, "Robin")
                .get("token").asText();

        mockMvc.perform(post("/api/auth/session")
                        .header("Authorization", "Bearer " + strangerToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("accountId", firstAccountId))))
                .andExpect(status().isNotFound());
    }

    // Switching household is the same route as finishing a login, reached with an ordinary session
    // token instead of a selection one. Keeping it one route is what stops the two drifting apart.
    @Test
    void aFullTokenSwitchesBetweenTheHouseholdsItBelongsTo() throws Exception {
        String selectionToken = login(sharedEmail).get("selectionToken").asText();
        String inSecond = json(mockMvc.perform(post("/api/auth/session")
                .header("Authorization", "Bearer " + selectionToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("accountId", secondAccountId)))))
                .get("token").asText();

        JsonNode switched = json(mockMvc.perform(post("/api/auth/session")
                .header("Authorization", "Bearer " + inSecond)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("accountId", firstAccountId))))
                .andExpect(status().isOk()));

        assertThat(switched.get("account").get("id").asLong()).isEqualTo(firstAccountId);
        assertThat(switched.get("membership").get("accountRole").asText()).isEqualTo("OWNER");
    }

    @Test
    void mintingWithNoTokenOrAJunkTokenIsRefused() throws Exception {
        String body = objectMapper.writeValueAsString(Map.of("accountId", firstAccountId));

        mockMvc.perform(post("/api/auth/session").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(post("/api/auth/session")
                        .header("Authorization", "Bearer not-a-token")
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isUnauthorized());
    }
}
