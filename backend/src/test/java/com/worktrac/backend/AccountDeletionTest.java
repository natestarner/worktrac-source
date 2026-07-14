package com.worktrac.backend;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.worktrac.backend.account.AccountRepository;
import com.worktrac.backend.category.CategoryRepository;
import com.worktrac.backend.email.EmailService;
import com.worktrac.backend.exercise.ExerciseRepository;
import com.worktrac.backend.person.PersonRepository;
import com.worktrac.backend.support.RegistrationTestSupport;
import com.worktrac.backend.user.TestCodeCache;
import com.worktrac.backend.user.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.MSSQLServerContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

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
// setup values, its own exercises/categories, its user, and the account row itself) while
// leaving every other account -- and every global/system exercise and category -- exactly
// as it was. That isolation guarantee is the single most important thing to get right
// here, same as MultiTenancyIsolationTest.
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("local")
@Testcontainers
class AccountDeletionTest {

    @Container
    @ServiceConnection
    static MSSQLServerContainer<?> sqlServer = new MSSQLServerContainer<>("mcr.microsoft.com/mssql/server:2022-latest")
            .acceptLicense();

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
    private CategoryRepository categoryRepository;

    // EmailService's real constructor builds a live Azure EmailClient from
    // app.email.connection-string, which is empty in the "local" test profile (no real ACS
    // resource in CI) -- @MockitoBean replaces the bean entirely so that constructor never runs.
    @MockitoBean
    private EmailService emailService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private JsonNode register(String email, String personName) throws Exception {
        return RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache, email, personName);
    }

    // Populates one account with a person, a logged set (creating a session + a set, and
    // exercising the setup-values path), a custom exercise, and a custom category -- the
    // full blast radius a real household's account would have accumulated.
    private void seedAccountData(String token, long personId) throws Exception {
        String categoryBody = objectMapper.writeValueAsString(Map.of("name", "Custom Category " + personId));
        long categoryId = objectMapper.readTree(mockMvc.perform(post("/api/categories")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(categoryBody))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString()).get("id").asLong();

        String exerciseBody = objectMapper.writeValueAsString(Map.of(
                "name", "Custom Exercise " + personId,
                "categoryId", categoryId,
                "setupFieldNames", List.of("Pin height")));
        long exerciseId = objectMapper.readTree(mockMvc.perform(post("/api/exercises")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(exerciseBody))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString()).get("id").asLong();

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

        // Account B is completely untouched -- its person, custom exercise/category, and
        // account row must all still be reachable via its own token.
        assertTrue(accountRepository.findById(accountIdB).isPresent());
        assertEquals(1, personRepository.findByAccount_IdOrderByCreatedAtAsc(accountIdB).size());
        assertEquals(personIdB, personRepository.findByAccount_IdOrderByCreatedAtAsc(accountIdB).get(0).getId());

        mockMvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + tokenB))
                .andExpect(status().isOk());

        JsonNode categoriesB = objectMapper.readTree(mockMvc.perform(get("/api/categories")
                        .header("Authorization", "Bearer " + tokenB))
                .andReturn().getResponse().getContentAsString());
        assertTrue(containsName(categoriesB, "Custom Category " + personIdB));

        JsonNode exercisesB = objectMapper.readTree(mockMvc.perform(get("/api/exercises")
                        .header("Authorization", "Bearer " + tokenB))
                .andReturn().getResponse().getContentAsString());
        assertTrue(containsName(exercisesB, "Custom Exercise " + personIdB));
    }

    @Test
    void deletingAccountDoesNotTouchGlobalExercisesOrCategories() throws Exception {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        JsonNode registration = register("deleteglobal-" + suffix + "@example.com", "Alex");
        String token = registration.get("token").asText();

        long globalCategoryCountBefore = categoryRepository.findVisibleToAccount(-1L).size();
        long globalExerciseCountBefore = exerciseRepository.findVisibleToAccount(-1L).size();

        mockMvc.perform(delete("/api/account")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(deleteAccountBody("DELETE")))
                .andExpect(status().isNoContent());

        // -1L never matches any real account, so findVisibleToAccount(-1L) returns exactly
        // the global (account_id IS NULL) rows -- unaffected by any account's deletion.
        assertEquals(globalCategoryCountBefore, categoryRepository.findVisibleToAccount(-1L).size());
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
}
