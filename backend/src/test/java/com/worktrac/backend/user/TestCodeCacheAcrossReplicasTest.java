package com.worktrac.backend.user;

import com.worktrac.backend.email.EmailService;
import com.worktrac.backend.support.AbstractIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

// The e2e reads a code back through GET /api/auth/test/pending-code, which can land on a different
// replica from the request that issued it. "Another replica" is another TestCodeCache instance on
// the same database -- exactly what a second JVM would have.
class TestCodeCacheAcrossReplicasTest extends AbstractIntegrationTest {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, TestCodeCacheAcrossReplicasTest.class);
    }

    @MockitoBean
    private EmailService emailService;

    @Autowired
    private TestCodeCache replicaA;

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private TransactionTemplate transactionTemplate;

    @Test
    void aCodeIssuedOnOneReplicaCanBeReadOnAnother() {
        TestCodeCache replicaB = new TestCodeCache(jdbc);
        String email = "code-" + UUID.randomUUID() + "@example.com";

        replicaA.put(email, "123456");

        assertThat(replicaB.get(email)).isEqualTo("123456");
    }

    @Test
    void aResendReplacesTheCode() {
        String email = "resend-" + UUID.randomUUID() + "@example.com";

        replicaA.put(email, "111111");
        replicaA.put(email, "222222");

        assertThat(new TestCodeCache(jdbc).get(email)).isEqualTo("222222");
    }

    @Test
    void aCodeFromARolledBackRegistrationIsNeverVisible() {
        String email = "rolled-back-" + UUID.randomUUID() + "@example.com";

        assertThatThrownBy(() -> transactionTemplate.executeWithoutResult(status -> {
            replicaA.put(email, "333333");
            throw new IllegalStateException("registration failed");
        })).isInstanceOf(IllegalStateException.class);

        assertThat(replicaA.get(email)).isNull();
    }
}
