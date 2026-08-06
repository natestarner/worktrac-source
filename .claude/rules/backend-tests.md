---
paths:
  - "backend/src/test/**"
---

# Backend testing rules

Full narrative: `docs/architecture/testing.md`.

- JUnit 5 + Spring Boot Test. Minimum bar: a test for any new endpoint or user-facing feature.
- **Every integration test (Spring context + database) extends
  `support/AbstractIntegrationTest.java`**, which starts ONE singleton `MSSQLServerContainer` for
  the whole JVM. 24 classes used to mean 24 containers — that is what crashed on `fs.aio-max-nr`.
  Each class still gets its own isolated database on that one container via a
  `@DynamicPropertySource` method calling `registerDatasource`, so per-class data isolation is
  unchanged.
- `bash scripts/test-backend.sh unit` runs just the ~10 non-container unit classes (seconds, not
  minutes) via `-DexcludedGroups=integration`. `bash scripts/test-backend.sh` or plain
  `mvn verify` runs everything.

## Class-level parallelism is deliberately 1 — do not raise it

`junit-platform.properties` is back at 1, not the 4 it briefly was, after **two independent real
concurrency bugs**:

1. Spring Boot's `LogbackLoggingSystem` resets the JVM-shared Logback `LoggerContext` on every new
   context startup, silently detaching a manually-attached test appender (`LogCaptor`). A
   reset-resistant re-attach hook did **not** reliably fix it. Fixed by marking that one class
   `@Isolated`. **If a future test needs `LogCaptor`, mark it `@Isolated` too** rather than relying
   on cross-request log ordering under parallelism.
2. A separate Mockito `UnfinishedStubbing` failure in `PasswordResetControllerTest`, seen only on
   the real CI runner, never across 8+ local runs. Root cause unconfirmed.

Re-enabling parallelism needs: (a) root-causing the Mockito failure reproducibly outside CI,
(b) auditing the other 23 classes for both failure classes, (c) several green **CI** runs at the
target parallelism.
