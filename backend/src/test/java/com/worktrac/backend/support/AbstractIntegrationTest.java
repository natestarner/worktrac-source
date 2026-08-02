package com.worktrac.backend.support;

import org.junit.jupiter.api.Tag;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.testcontainers.containers.MSSQLServerContainer;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;

/**
 * Base for every Spring-context + database-backed backend integration test. Starts ONE
 * MSSQLServerContainer for the whole JVM (every subclass used to start its own -- 24
 * classes, 24 containers -- which is exactly what exhausted the host's async-I/O budget and
 * crashed every instance the one time class-level parallelism was tried; see
 * junit-platform.properties). This is Testcontainers' documented "singleton container"
 * pattern: the container is started once in a static initializer and deliberately never
 * stopped -- {@code @Testcontainers}/{@code @Container} manage per-class start/stop, which
 * would tear the shared container down after whichever subclass happens to finish first, so
 * they are intentionally NOT used here. The container is reaped by Testcontainers' Ryuk
 * sidecar (or simply dies with the JVM) when the test run ends.
 *
 * <p>Each subclass still gets its OWN isolated, empty database on that one container --
 * preserving today's per-class data isolation exactly -- by declaring a small
 * {@code @DynamicPropertySource} method that calls {@link #registerDatasource}, e.g.:
 * <pre>{@code
 * @DynamicPropertySource
 * static void datasource(DynamicPropertyRegistry registry) {
 *     registerDatasource(registry, MyTest.class);
 * }
 * }</pre>
 * This can't be hoisted into this base class as a single shared method: a static
 * {@code @DynamicPropertySource} method has no way to know which concrete subclass
 * triggered it, so each subclass must pass its own identity explicitly. This also
 * guarantees each subclass resolves a genuinely different {@code spring.datasource.url},
 * which is what makes Spring's test-context cache build a separate context per class here
 * (the same mechanism that already gives every class its own context today, since each
 * currently gets its own container with its own randomly-mapped port).
 */
@SpringBootTest
@ActiveProfiles("local")
@Tag("integration")
public abstract class AbstractIntegrationTest {

    protected static final MSSQLServerContainer<?> SQL_SERVER =
            new MSSQLServerContainer<>("mcr.microsoft.com/mssql/server:2022-latest").acceptLicense();

    static {
        SQL_SERVER.start();
    }

    protected static void registerDatasource(DynamicPropertyRegistry registry, Class<?> testClass) {
        String dbName = "it_" + testClass.getSimpleName().toLowerCase();
        createDatabaseIfAbsent(dbName);
        String url = "jdbc:sqlserver://" + SQL_SERVER.getHost() + ":" + SQL_SERVER.getMappedPort(1433)
                + ";database=" + dbName + ";encrypt=false;trustServerCertificate=true";
        registry.add("spring.datasource.url", () -> url);
        registry.add("spring.datasource.username", SQL_SERVER::getUsername);
        registry.add("spring.datasource.password", SQL_SERVER::getPassword);
    }

    private static synchronized void createDatabaseIfAbsent(String dbName) {
        String adminUrl = "jdbc:sqlserver://" + SQL_SERVER.getHost() + ":" + SQL_SERVER.getMappedPort(1433)
                + ";database=master;encrypt=false;trustServerCertificate=true";
        try (Connection conn = DriverManager.getConnection(adminUrl, SQL_SERVER.getUsername(), SQL_SERVER.getPassword());
             Statement stmt = conn.createStatement()) {
            stmt.execute("IF DB_ID(N'" + dbName + "') IS NULL EXEC('CREATE DATABASE [" + dbName + "]')");
        } catch (Exception e) {
            throw new IllegalStateException("Failed to create integration test database " + dbName, e);
        }
    }
}
