---
paths:
  - "backend/src/main/resources/db/migration/**"
---

# Flyway migration rules

- **NEVER edit or rename a migration that has already been applied** — create a new one.
- One logical change per file (don't combine table creates).
- Descriptive names: `V3__add_email_verified_to_users.sql`, not `V3__update.sql`.
- Seed/reference data goes in migrations too (e.g. `V4__seed_roles.sql`).
- Version numbers must be **sequential** — never skip or reuse a number.
- Always use `IF NOT EXISTS` / `IF EXISTS` guards where T-SQL supports them.

## T-SQL dialect

The full T-SQL vs MySQL/Postgres table is in `CLAUDE.md` (always loaded). Migrations use
T-SQL syntax exclusively.

## Schema changes

Database schema changes go **in a migration file, never manual DDL**, and
`spring.jpa.hibernate.ddl-auto` stays `validate`.
