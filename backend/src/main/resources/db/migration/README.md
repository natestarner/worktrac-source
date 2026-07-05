# Flyway Migrations

Empty for now — the workout tracker's actual schema (people, workouts, exercises, sets)
hasn't been designed yet. This is intentional: pipeline infrastructure is being set up
first, app data model comes next (see project task list).

When you add the first migration, name it `V1__<description>.sql` and follow the rules
in `CLAUDE.md` (never edit an applied migration, one logical change per file, T-SQL
syntax only).
