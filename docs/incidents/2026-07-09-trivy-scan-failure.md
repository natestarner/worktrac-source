# Trivy scan failure (2026-07-09)

- `docker-build`'s Trivy scan started silently failing every push despite the workflow's
  `severity: 'CRITICAL,HIGH'` filter, because a LOW-severity CVE landed in a transitive dep
  (`logback-core`) — an upstream trivy-action bug
  ([trivy-action#309](https://github.com/aquasecurity/trivy-action/issues/309)): without
  `limit-severities-for-sarif: true`, `exit-code` evaluates against the unfiltered SARIF set
  regardless of the `severity` input.
- **Takeaway:** `limit-severities-for-sarif: true` is now set on the Trivy step so a future
  LOW/MEDIUM finding can't silently fail the build the same way again. If a real HIGH/CRITICAL
  finding ever fails the build, patch/upgrade the flagged dependency rather than narrowing
  `vuln-type` — that keeps full scan coverage instead of trading it away. Full investigation
  narrative: `git log --grep=Trivy -i` (PRs #23, #24).

