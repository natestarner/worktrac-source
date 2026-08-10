---
paths:
  - "backend/Dockerfile"
  - "backend/pom.xml"
  - ".github/dependabot.yml"
---

# Backend JDK version must stay in lockstep across three files

`backend/pom.xml`'s `<java.version>`, `backend/Dockerfile`'s build-stage image
(`maven:X-eclipse-temurin-<JDK>`), and its runtime-stage image
(`eclipse-temurin:<JDK>-jre-alpine`) must always name the **same** JDK version. A Java upgrade is
a deliberate, coordinated change — bump all three together, in one PR, with the full backend
suite run against it. Never let a Docker base-image bump quietly move the JDK ahead of what
`pom.xml` targets.

**Don't trust Dependabot's own classification of this to catch a mismatch.** Its version parser
reads a compound tag like `maven:3.9-eclipse-temurin-25` by its leading segment only, so a JDK
bump hidden in the trailing `-eclipse-temurin-NN` can get waved through as "minor/patch" even
with an `ignore: semver-major` rule in place for it — see
[docs/incidents/2026-08-09-dependabot-jdk-tag-misclassification.md](../../docs/incidents/2026-08-09-dependabot-jdk-tag-misclassification.md).

`scripts/check-jdk-alignment.sh` (run as the first step of `backend-ci`) is the actual backstop —
it fails the build if the three versions ever disagree, regardless of how the mismatch was
introduced. If you're bumping the JDK on purpose, run it locally after your edit to confirm all
three still agree before opening the PR.

Also worth choosing correctly: only move to a new JDK version that's actually LTS. A non-LTS
release gets ~6 months of updates and then goes EOL the moment the next release ships — see
[Oracle's Java SE support roadmap](https://www.oracle.com/java/technologies/java-se-support-roadmap.html)
before picking a target.
