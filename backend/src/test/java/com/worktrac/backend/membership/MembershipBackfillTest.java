package com.worktrac.backend.membership;

import com.worktrac.backend.support.AbstractIntegrationTest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

// V64 is a ONE-SHOT migration against real production data, and nothing else in the suite
// exercises it: every test database is created fresh, so every account in every other test gets
// its membership from RegistrationService rather than from the backfill. That leaves the one
// statement that will run against every existing household completely uncovered.
//
// So this seeds rows in exactly the shape V64 will find in production -- a user carrying the
// legacy users.account_id with no membership -- and runs the migration's own SQL against them.
// The statement is duplicated here deliberately; the alternative is asserting nothing about it.
class MembershipBackfillTest extends AbstractIntegrationTest {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, MembershipBackfillTest.class);
    }

    // Verbatim from V64__backfill_account_memberships.sql. If that file changes, this must change
    // with it -- the two are independently maintained copies of one statement, like
    // TestDataCleanupService's email patterns and e2e's registerHousehold.
    private static final String BACKFILL = """
            INSERT INTO account_memberships (account_id, user_id, person_id, account_role)
            SELECT u.account_id,
                   u.id,
                   (SELECT TOP(1) p.id
                      FROM people p
                     WHERE p.account_id = u.account_id
                       AND p.is_primary = 1
                     ORDER BY p.created_at ASC, p.id ASC),
                   'OWNER'
            FROM users u
            WHERE u.account_id IS NOT NULL
              AND NOT EXISTS (SELECT 1
                                FROM account_memberships m
                               WHERE m.account_id = u.account_id
                                 AND m.user_id = u.id)
            """;

    @Autowired
    private JdbcTemplate jdbc;

    @BeforeEach
    void clean() {
        jdbc.update("DELETE FROM account_memberships");
        jdbc.update("DELETE FROM people");
        jdbc.update("DELETE FROM users");
        jdbc.update("DELETE FROM subscriptions");
        jdbc.update("DELETE FROM accounts");
    }

    // OUTPUT INSERTED.id rather than SCOPE_IDENTITY(): that function is scoped to one SESSION,
    // and JdbcTemplate takes a fresh connection from the pool per statement, so the follow-up
    // SELECT reliably returned NULL.
    private long seedAccount(String name) {
        return jdbc.queryForObject(
                "INSERT INTO accounts (name, default_unit, created_at) OUTPUT INSERTED.id VALUES (?, 'lb', GETDATE())",
                Long.class, name);
    }

    private long seedLegacyUser(long accountId, String email) {
        return jdbc.queryForObject("""
                INSERT INTO users (account_id, email, password_hash, role, token_version,
                                   failed_login_attempts, created_at)
                OUTPUT INSERTED.id
                VALUES (?, ?, 'hash', 'USER', 0, 0, GETDATE())
                """, Long.class, accountId, email);
    }

    private long seedPerson(long accountId, String name, boolean primary, String createdAt) {
        return jdbc.queryForObject("INSERT INTO people (account_id, name, is_primary, rest_timer_enabled, created_at) "
                + "OUTPUT INSERTED.id VALUES (?, ?, ?, 1, ?)", Long.class, accountId, name, primary ? 1 : 0, createdAt);
    }

    private List<Map<String, Object>> memberships() {
        return jdbc.queryForList("SELECT account_id, user_id, person_id, account_role FROM account_memberships");
    }

    @Test
    void givesEveryExistingLoginAnOwnerMembershipBoundToThePrimaryPerson() {
        long accountId = seedAccount("Starner Household");
        long userId = seedLegacyUser(accountId, "nate@example.com");
        seedPerson(accountId, "Sam", false, "2026-01-02T00:00:00");
        long primaryId = seedPerson(accountId, "Nate", true, "2026-01-01T00:00:00");

        jdbc.update(BACKFILL);

        assertThat(memberships()).singleElement().satisfies(row -> {
            assertThat(row.get("account_id")).isEqualTo(accountId);
            assertThat(row.get("user_id")).isEqualTo(userId);
            assertThat(row.get("person_id")).isEqualTo(primaryId);
            // Nobody's access changes: every login that exists today IS its account's owner,
            // because that is the only kind of login the app could create.
            assertThat(row.get("account_role")).isEqualTo("OWNER");
        });
    }

    // An account with no primary person must still get a membership. Dropping the row instead
    // would lock that household out entirely at the moment the filter starts requiring one.
    @Test
    void stillCreatesAMembershipWhenTheAccountHasNoPrimaryPerson() {
        long accountId = seedAccount("No Primary");
        long userId = seedLegacyUser(accountId, "orphan@example.com");
        seedPerson(accountId, "Only", false, "2026-01-01T00:00:00");

        jdbc.update(BACKFILL);

        assertThat(memberships()).singleElement().satisfies(row -> {
            assertThat(row.get("user_id")).isEqualTo(userId);
            assertThat(row.get("person_id")).isNull();
            assertThat(row.get("account_role")).isEqualTo("OWNER");
        });
    }

    // Two primaries is not supposed to happen -- is_primary is not unique in the schema -- but if
    // it did, an unordered subquery would return two rows and fail the WHOLE migration for every
    // household. TOP(1) with an explicit ORDER BY is what makes that a non-event.
    @Test
    void survivesAnAccountWithTwoPrimaryPeople() {
        long accountId = seedAccount("Double Primary");
        seedLegacyUser(accountId, "dup@example.com");
        long older = seedPerson(accountId, "First", true, "2026-01-01T00:00:00");
        seedPerson(accountId, "Second", true, "2026-02-01T00:00:00");

        jdbc.update(BACKFILL);

        assertThat(memberships()).singleElement()
                .satisfies(row -> assertThat(row.get("person_id")).isEqualTo(older));
    }

    // Flyway will not re-run an applied migration, but a backfill that is safe to run twice is one
    // that can be reasoned about after a restore or a hand-repaired schema history.
    @Test
    void isIdempotent() {
        long accountId = seedAccount("Idempotent");
        seedLegacyUser(accountId, "twice@example.com");
        seedPerson(accountId, "Nate", true, "2026-01-01T00:00:00");

        jdbc.update(BACKFILL);
        jdbc.update(BACKFILL);

        assertThat(memberships()).hasSize(1);
    }

    @Test
    void ignoresAUserThatAlreadyHasAMembership() {
        long accountId = seedAccount("Already Migrated");
        long userId = seedLegacyUser(accountId, "member@example.com");
        long personId = seedPerson(accountId, "Nate", true, "2026-01-01T00:00:00");
        jdbc.update("INSERT INTO account_memberships (account_id, user_id, person_id, account_role, created_at) "
                + "VALUES (?, ?, ?, 'MEMBER', GETDATE())", accountId, userId, personId);

        jdbc.update(BACKFILL);

        // Still one row, and still MEMBER -- the backfill must never promote an existing row.
        assertThat(memberships()).singleElement()
                .satisfies(row -> assertThat(row.get("account_role")).isEqualTo("MEMBER"));
    }

    // A user with no legacy account_id is a login created AFTER the split (an invited member in
    // phase 7). The backfill must skip it rather than inserting a NULL account_id and failing.
    @Test
    void skipsALoginWithNoLegacyAccountId() {
        seedAccount("Post Split");
        jdbc.update("""
                INSERT INTO users (account_id, email, password_hash, role, token_version,
                                   failed_login_attempts, created_at)
                VALUES (NULL, 'invited@example.com', 'hash', 'USER', 0, 0, GETDATE())
                """);

        jdbc.update(BACKFILL);

        assertThat(memberships()).isEmpty();
    }
}
