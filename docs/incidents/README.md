# Resolved Incidents

Post-mortems for bugs that were expensive to find. Each entry records the symptom, the root
cause, and the takeaway — the invariant a future change must not break.

These are **not** loaded into Claude's context automatically. The short invariant that came out
of each one lives in the matching `.claude/rules/*.md` file (which *does* auto-load when Claude
touches the relevant code); this directory holds the full investigation narrative for when you
need the "why" or the debugging story.

| Date | Incident | Area |
|---|---|---|
| 2026-07-09 | [Trivy scan failure](2026-07-09-trivy-scan-failure.md) — a LOW-severity CVE silently failed every build | CI |
| 2026-07-17 | [Silent registration failures in production](2026-07-17-silent-registration-failures.md) — zero trace anywhere; also exposed a shared per-IP rate-limit bucket behind the proxy | Auth / infra |
| 2026-07-27 | [A local DB outage force-logged the user out](2026-07-27-db-outage-forced-logout.md) instead of degrading gracefully | Offline / auth |
| 2026-07-28 | [Cached sections went blank during a prolonged lie-fi session](2026-07-28-liefi-cached-sections-blank.md) | Offline |
| 2026-07-28 | [The offline banner's "Go back online" button never worked](2026-07-28-offline-banner-go-back-online.md) — CORS was missing on `/actuator/health` | Offline / CORS |
| 2026-07-29 | [The durable outbox could replay out of enqueue order](2026-07-29-outbox-replay-order-deadlock.md), deadlocking every queued write | Offline |
| 2026-07-30 | [Editing a still-queued offline set could reorder it, or silently lose the edit](2026-07-30-editing-queued-offline-set.md) | Offline |
| 2026-07-31 | [A stale boot `/me` response could clobber a fresh login's `freshLogin` flag](2026-07-31-stale-me-clobbers-freshlogin.md) | Auth / frontend state |
| 2026-08-01 | [The outbox could still reorder despite the 2026-07-29 fix](2026-08-01-outbox-reorder-enqueueseq.md) — `submittedAt` is mutable; `enqueueSeq` replaced it | Offline |
| 2026-08-01 | [A verification email vanished with zero trace, and the test-data delete timed out](2026-08-01-email-blind-spots-and-delete-timeout.md) | Registration / async |
| 2026-08-05 | [Tagging a never-favorited/logged/noted exercise never showed on screen](2026-08-05-exercise-personalization-picker-gap.md) | Data model |
| 2026-08-08 | [An ended workout came back to life on lower](2026-08-08-ended-workout-resurrected-by-persisted-cache.md) — a silent SW reload beat the throttled persist of the end | Offline / persistence |
| 2026-08-08 | [Hovering the Trends weekly chart blanked the page](2026-08-08-trends-hover-blank-page.md) — a persisted UI slice predating a new field hydrated as `undefined` | Frontend state / trends |
| 2026-08-08 | [A restored cache entry looked "freshly checked", so nothing refetched it](2026-08-08-restored-cache-looks-fresh.md) — a routine created just before a reload stayed missing for minutes | Offline / persistence |
| 2026-08-09 | [Dependabot misclassified a JDK bump as minor/patch](2026-08-09-dependabot-jdk-tag-misclassification.md) — a compound Docker tag hid a major JDK jump from the existing `ignore:` rule | CI / Docker |
| 2026-08-10 | [A sticky modal header clipped the first field's top border](2026-08-10-sticky-modal-header-clips-first-field.md) — a negative-margin/sticky conflict, then a stacking-context paintover that survived one verified fix | Frontend / design system |
| 2026-08-12 | [The weight prefill overwrote a weight the person had typed](2026-08-12-prefill-overwrites-typed-weight.md) — known since 2026-08-08 and worked around in the e2e helpers rather than fixed; surfaced as a missing PR celebration | Log screen / frontend state |
| 2026-08-12 | [A live session the client invented was restored as if the server had said it](2026-08-12-provisional-live-session-restored-as-fresh.md) — a synced set vanished from "This session" after a reload; also caught three parity modes passing vacuously | Offline / persistence |
| 2026-08-13 | [The e2e suite only passed at `--workers=1`](2026-08-13-e2e-parallel-flakiness.md) — not a data-isolation bug: local SQL Server lacked Azure's `READ_COMMITTED_SNAPSHOT`, and a rate-limit bucket that punished *fast* runs | E2E / local env |

## Adding a new incident

1. Add `YYYY-MM-DD-slug.md` here with the full narrative — symptom, root cause, takeaway.
2. Add a row to the table above.
3. **If it produced an invariant a future change must not break**, add that invariant to the
   matching `.claude/rules/*.md` file. That's the part that actually prevents a repeat, because
   it auto-loads when Claude edits the relevant code.
4. Do **not** add the narrative to `CLAUDE.md` — see "Where new documentation goes" there.
