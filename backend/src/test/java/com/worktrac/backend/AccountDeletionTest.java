package com.worktrac.backend;

import com.worktrac.backend.support.AbstractIntegrationTest;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.worktrac.backend.account.AccountRepository;
import com.worktrac.backend.email.EmailService;
import com.worktrac.backend.billing.BillingPlan;
import com.worktrac.backend.billing.BillingEventRepository;
import com.worktrac.backend.billing.BillingEventType;
import com.worktrac.backend.billing.StripeService;
import com.worktrac.backend.billing.Subscription;
import com.worktrac.backend.billing.SubscriptionRepository;
import com.worktrac.backend.billing.SubscriptionStatus;
import com.worktrac.backend.contact.ContactMessageRepository;
import com.worktrac.backend.exercise.ExerciseRepository;
import com.worktrac.backend.person.PersonRepository;
import com.worktrac.backend.support.RegistrationTestSupport;
import com.worktrac.backend.user.TestCodeCache;
import com.worktrac.backend.user.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// Deleting an account must erase every row it owns (people, sessions, sets, routines,
// setup values, its own exercises, its tags, its user, and the account row itself) while
// leaving every other account -- and every global/system exercise -- exactly as it was.
// That isolation guarantee is the single most important thing to get right here, same as
// MultiTenancyIsolationTest.
@AutoConfigureMockMvc
class AccountDeletionTest extends AbstractIntegrationTest {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, AccountDeletionTest.class);
    }

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private TestCodeCache testCodeCache;

    @Autowired
    private PersonRepository personRepository;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private AccountRepository accountRepository;

    @Autowired
    private ExerciseRepository exerciseRepository;

    @Autowired
    private SubscriptionRepository subscriptionRepository;

    @Autowired
    private ContactMessageRepository contactMessageRepository;

    @Autowired
    private BillingEventRepository billingEventRepository;

    // Stripe is unconfigured in the test profile, so the cancel-on-deletion path would never
    // run at all without this. Mocked rather than skipped because the ORDERING of that call
    // relative to the deletes is the thing worth pinning.
    @MockitoBean
    private StripeService stripeService;

    // EmailService's real constructor builds a live Azure EmailClient from
    // app.email.connection-string, which is empty in the "local" test profile (no real ACS
    // resource in CI) -- @MockitoBean replaces the bean entirely so that constructor never runs.
    @MockitoBean
    private EmailService emailService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private JsonNode register(String email, String personName) throws Exception {
        return RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache, email, personName);
    }

    // Populates one account with a person, a logged set (creating a session + a set), a
    // custom exercise with a per-person setup field, and a tag applied to it -- the full blast
    // radius a real household's account would have accumulated.
    private void seedAccountData(String token, long personId) throws Exception {
        String exerciseBody = objectMapper.writeValueAsString(Map.of(
                "name", "Custom Exercise " + personId));
        long exerciseId = objectMapper.readTree(mockMvc.perform(post("/api/exercises")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(exerciseBody))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString()).get("id").asLong();

        String fieldBody = objectMapper.writeValueAsString(Map.of("name", "Pin height"));
        mockMvc.perform(post("/api/people/" + personId + "/exercises/" + exerciseId + "/custom-fields")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(fieldBody))
                .andExpect(status().isOk());

        mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .put("/api/people/" + personId + "/exercises/" + exerciseId + "/tags")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("tags", List.of("My Tag " + personId)))))
                .andExpect(status().isOk());

        String setBody = objectMapper.writeValueAsString(Map.of("exerciseId", exerciseId, "weight", 135, "reps", 8));
        mockMvc.perform(post("/api/people/" + personId + "/live-sets")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(setBody))
                .andExpect(status().isOk());

        String routineBody = objectMapper.writeValueAsString(Map.of(
                "name", "Custom Routine " + personId, "exerciseIds", List.of(exerciseId)));
        mockMvc.perform(post("/api/people/" + personId + "/routines")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(routineBody))
                .andExpect(status().isOk());

        // A Contact Us submission, with personId set. This belongs in the standard blast radius
        // and not in one special-case test: contact_messages holds NO ACTION FKs to accounts,
        // users AND people, so every delete in AccountDeletionService failed with a constraint
        // violation while one was around -- meaning any household that had ever written in could
        // not delete its account, and got a 503 from an irreversible action they had confirmed.
        // Seeding it here means every deletion test below exercises those three constraints.
        String contactBody = objectMapper.writeValueAsString(Map.of(
                "category", "BUG",
                "subject", "Something looked wrong",
                "message", "Writing in about a thing that did not work as I expected.",
                "personId", personId));
        mockMvc.perform(post("/api/contact")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(contactBody))
                .andExpect(status().isAccepted());
    }

    private String deleteAccountBody(String confirmationText) throws Exception {
        return objectMapper.writeValueAsString(Map.of("confirmationText", confirmationText));
    }

    @Test
    void deletingAccountRemovesEverythingItOwns() throws Exception {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        String email = "deleteme-" + suffix + "@example.com";
        JsonNode registration = register(email, "Alex");
        String token = registration.get("token").asText();
        long accountId = registration.get("account").get("id").asLong();
        long personId = registration.get("person").get("id").asLong();

        seedAccountData(token, personId);

        mockMvc.perform(delete("/api/account")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(deleteAccountBody("DELETE")))
                .andExpect(status().isNoContent());

        assertTrue(personRepository.findByAccount_IdOrderByCreatedAtAsc(accountId).isEmpty());
        assertFalse(userRepository.existsByEmail(email));
        assertTrue(accountRepository.findById(accountId).isEmpty());
        // subscriptions has a NO ACTION FK to accounts (V56), so this row is not merely tidy-up:
        // if AccountDeletionService stops clearing it, the account delete above fails outright with
        // a constraint violation rather than leaving an orphan.
        assertTrue(subscriptionRepository.findByAccountId(accountId).isEmpty());
    }

    // Registration is the single insertion point for a household's subscription row, so "every
    // account has exactly one" is true from the moment it exists rather than only for households
    // that reach billing. A missing row resolves to FREE anyway (SubscriptionService), but that is
    // a safety net, not the design.
    @Test
    void confirmingRegistrationCreatesAFreeSubscription() throws Exception {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        JsonNode registration = register("newsub-" + suffix + "@example.com", "Alex");
        long accountId = registration.get("account").get("id").asLong();

        var subscription = subscriptionRepository.findByAccountId(accountId);

        assertTrue(subscription.isPresent());
        assertEquals(BillingPlan.FREE, subscription.get().getPlan());
        assertEquals(SubscriptionStatus.FREE, subscription.get().getStatus());
        assertFalse(subscription.get().isComped());
        // And the derived entitlement reaches the client on the very response that created it.
        assertEquals("FREE", registration.get("account").get("plan").asText());
    }

    @Test
    void deletingAccountDoesNotTouchAnotherAccountsData() throws Exception {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        JsonNode regA = register("deleteA-" + suffix + "@example.com", "Alex");
        String tokenA = regA.get("token").asText();
        long accountIdA = regA.get("account").get("id").asLong();
        long personIdA = regA.get("person").get("id").asLong();
        seedAccountData(tokenA, personIdA);

        JsonNode regB = register("deleteB-" + suffix + "@example.com", "Blair");
        String tokenB = regB.get("token").asText();
        long accountIdB = regB.get("account").get("id").asLong();
        long personIdB = regB.get("person").get("id").asLong();
        seedAccountData(tokenB, personIdB);

        mockMvc.perform(delete("/api/account")
                        .header("Authorization", "Bearer " + tokenA)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(deleteAccountBody("DELETE")))
                .andExpect(status().isNoContent());

        assertTrue(accountRepository.findById(accountIdA).isEmpty());

        // Account B is completely untouched -- its person, custom exercise/tag, and account
        // row must all still be reachable via its own token.
        assertTrue(accountRepository.findById(accountIdB).isPresent());
        assertEquals(1, personRepository.findByAccount_IdOrderByCreatedAtAsc(accountIdB).size());
        assertEquals(personIdB, personRepository.findByAccount_IdOrderByCreatedAtAsc(accountIdB).get(0).getId());

        mockMvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + tokenB))
                .andExpect(status().isOk());

        JsonNode tagsB = objectMapper.readTree(mockMvc.perform(get("/api/tags")
                        .header("Authorization", "Bearer " + tokenB))
                .andReturn().getResponse().getContentAsString());
        assertTrue(containsName(tagsB, "My Tag " + personIdB));

        JsonNode exercisesB = objectMapper.readTree(mockMvc.perform(get("/api/exercises")
                        .header("Authorization", "Bearer " + tokenB))
                .andReturn().getResponse().getContentAsString());
        assertTrue(containsName(exercisesB, "Custom Exercise " + personIdB));
    }

    @Test
    void deletingAccountDoesNotTouchGlobalExercises() throws Exception {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        JsonNode registration = register("deleteglobal-" + suffix + "@example.com", "Alex");
        String token = registration.get("token").asText();

        long globalExerciseCountBefore = exerciseRepository.findVisibleToAccount(-1L).size();

        mockMvc.perform(delete("/api/account")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(deleteAccountBody("DELETE")))
                .andExpect(status().isNoContent());

        // -1L never matches any real account, so findVisibleToAccount(-1L) returns exactly
        // the global (account_id IS NULL) rows -- unaffected by any account's deletion.
        assertEquals(globalExerciseCountBefore, exerciseRepository.findVisibleToAccount(-1L).size());
    }

    @Test
    void wrongConfirmationTextDoesNotDeleteAccount() throws Exception {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        JsonNode registration = register("wrongword-" + suffix + "@example.com", "Alex");
        String token = registration.get("token").asText();
        long accountId = registration.get("account").get("id").asLong();

        mockMvc.perform(delete("/api/account")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(deleteAccountBody("delete")))
                .andExpect(status().isBadRequest());

        mockMvc.perform(delete("/api/account")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(deleteAccountBody("")))
                .andExpect(status().isBadRequest());

        assertTrue(accountRepository.findById(accountId).isPresent());
        mockMvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk());
    }

    @Test
    void sameEmailCanRegisterAgainAfterAccountDeletion() throws Exception {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        String email = "reuse-" + suffix + "@example.com";
        String token = register(email, "Alex").get("token").asText();

        mockMvc.perform(delete("/api/account")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(deleteAccountBody("DELETE")))
                .andExpect(status().isNoContent());

        assertFalse(userRepository.existsByEmail(email));

        // Registering fresh with the same email must succeed exactly as if it were new.
        JsonNode secondRegistration = register(email, "Alex Again");
        assertTrue(userRepository.existsByEmail(email));
        assertEquals("Alex Again", secondRegistration.get("person").get("name").asText());
    }

    private boolean containsName(JsonNode items, String name) {
        for (JsonNode item : items) {
            if (item.get("name").asText().equals(name)) return true;
        }
        return false;
    }

    @Test
    void deletingAccountRemovesItsContactMessages() throws Exception {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        String email = "deletecontact-" + suffix + "@example.com";
        JsonNode registration = register(email, "Robin");
        String token = registration.get("token").asText();
        long accountId = registration.get("account").get("id").asLong();
        long personId = registration.get("person").get("id").asLong();
        seedAccountData(token, personId);

        assertEquals(1, contactMessageRepository.countByAccount_Id(accountId),
                "the seed should have left a contact message to delete");

        mockMvc.perform(delete("/api/account")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(deleteAccountBody("DELETE")))
                .andExpect(status().isNoContent());

        assertEquals(0, contactMessageRepository.countByAccount_Id(accountId));
        assertTrue(accountRepository.findById(accountId).isEmpty());
    }

    // Two things at once, because they share one cause: the Stripe cancellation must happen AFTER
    // the transaction commits.
    //
    //   - Cancelling is an external side effect that cannot roll back. Done before the deletes,
    //     any failure below left the household with their subscription cancelled and their account
    //     intact -- Pro gone, data kept, told the operation failed.
    //   - The canceller records its outcome as a BillingEvent, described in its own comments as
    //     the only remaining record of what needs cancelling by hand. AccountDeletionService
    //     clears billing_events, so an event written beforehand was deleted by the very
    //     transaction it was recording.
    @Test
    void stripeCancellationHappensAfterCommitAndItsAuditRowSurvives() throws Exception {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        String email = "deletestripe-" + suffix + "@example.com";
        JsonNode registration = register(email, "Sam");
        String token = registration.get("token").asText();
        long accountId = registration.get("account").get("id").asLong();

        org.mockito.Mockito.when(stripeService.isConfigured()).thenReturn(true);
        Subscription subscription = subscriptionRepository.findByAccountId(accountId).orElseThrow();
        subscription.setStripeSubscriptionId("sub_test_" + suffix);
        subscriptionRepository.saveAndFlush(subscription);

        mockMvc.perform(delete("/api/account")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(deleteAccountBody("DELETE")))
                .andExpect(status().isNoContent());

        org.mockito.Mockito.verify(stripeService).cancelSubscription("sub_test_" + suffix);

        // Written by the afterCommit hook, i.e. after billing_events was cleared -- so it is still
        // here. Before this fix the row was recorded and then deleted moments later.
        assertTrue(billingEventRepository.findByAccountIdOrderByCreatedAtDesc(accountId).stream()
                        .anyMatch(event -> event.getEventType() == BillingEventType.CANCELED_ON_ACCOUNT_DELETION),
                "the cancellation audit row must outlive the account it refers to");
    }
}
