package com.worktrac.backend;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.test.context.ActiveProfiles;
import org.testcontainers.containers.MSSQLServerContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

// "local" is activated so app.jwt.secret resolves to the dev-only secret in
// application-local.yml (the JwtService bean eagerly builds its signing key at startup).
@SpringBootTest
@ActiveProfiles("local")
@Testcontainers
class BackendApplicationTests {

    @Container
    @ServiceConnection
    static MSSQLServerContainer<?> sqlServer = new MSSQLServerContainer<>("mcr.microsoft.com/mssql/server:2022-latest")
            .acceptLicense();

    @Test
    void contextLoads() {
    }
}
