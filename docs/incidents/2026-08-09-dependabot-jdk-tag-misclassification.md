# Dependabot misclassified a JDK bump as minor/patch (2026-08-09)

- `.github/dependabot.yml`'s `docker-minor-and-patch` group already carried an `ignore:` rule
  blocking `semver-major` updates to `maven` and `eclipse-temurin`, specifically to stop a JDK
  bump from moving the build toolchain ahead of `backend/pom.xml`'s `<java.version>` — that's what
  PR #1 did, before the rule existed.
- PR #149 slipped through it anyway: it changed `backend/Dockerfile`'s build-stage image from
  `maven:3.9-eclipse-temurin-25` to `maven:3-eclipse-temurin-26` — JDK 25 → 26 — but Dependabot
  filed it inside `docker-minor-and-patch`, not as a standalone major PR. Its version parser reads
  this compound tag by the leading `3.9` → `3` segment only; it never recognized the trailing
  `-eclipse-temurin-26` as the semver-major jump the `ignore:` rule was written to catch. CI was
  green (the workflow doesn't build/test the Docker image on a PR), so nothing caught it
  automatically — it was only found by inspecting the diff by hand before merging.
- JDK 26 wouldn't have been the right target anyway: it's a non-LTS release (~6 months of updates,
  EOL the moment JDK 27 ships ~2026-09-15), where `pom.xml` was already on JDK 25, an LTS with
  support into 2033. Landing it would have meant another coordinated bump almost immediately.
- **Takeaway:** `.github/dependabot.yml`'s `docker-minor-and-patch` group now `exclude-patterns`s
  both `maven` and `eclipse-temurin` outright, so a bump to either — misclassified or not — always
  lands as its own solo, reviewable PR instead of hiding inside a bundle. That's still trusting
  human review to catch a repeat, though, so `scripts/check-jdk-alignment.sh` was added as a real
  backstop: it runs as the first step of `backend-ci` and fails the build if `pom.xml` and both
  Dockerfile `FROM` lines ever disagree on JDK version, regardless of how the mismatch was
  introduced. See [`.claude/rules/backend-jdk-version.md`](../../.claude/rules/backend-jdk-version.md) for the invariant.
