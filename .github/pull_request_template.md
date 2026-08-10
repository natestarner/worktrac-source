## What changed

<!-- Describe the changes made in this PR -->

## Why

<!-- Explain the motivation for the change -->

## How to test

<!-- Steps to verify this change works correctly -->

## Resilience

<!-- The app must behave the same in every condition. See .claude/rules/resilience.md. -->

Which axes does this change touch, and how was each verified?

- [ ] **A — Reachability**: online / slow / lie-fi / hard-offline / pinned-offline / flapping
- [ ] **B — Server answers unsuccessfully**: cold start / DB down / pool exhausted / definitive 4xx
- [ ] **C — Client lifecycle**: reload at any instant / SW forced reload / storage unavailable / multi-tab / person switch mid-outage
- [ ] **D — State from an earlier world**: persisted slice predating a schema change / restored-but-stale cache / unresolved temp ids / render-time throw

- [ ] No new connectivity branch — **or** it's justified and added to the register in `.claude/rules/resilience.md`
- [ ] Reuses an existing mechanism (no second way to do an existing job)
- [ ] `bash scripts/check-resilience-invariants.sh` passes

## Checklist

- [ ] Unit tests added/updated
- [ ] Flyway migration included (if schema change)
- [ ] No secrets or credentials in code
- [ ] API documentation updated (if endpoints changed)
- [ ] Playwright E2E test added (for new user flows)
- [ ] Parity test added for user-visible flows (`e2e/tests/support/parity.ts`)
