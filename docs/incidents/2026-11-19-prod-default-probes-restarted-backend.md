# Production's default health probes restarted the backend five times in a month (2026-11-19)

## Symptom

At 01:53 UTC on 2026-11-19 the Sev1 alert `worktrac-backend-prod-restarts` fired. Production's
backend stopped answering its health checks at 01:52:14. At 01:53:21 the platform logged "failed
liveness probe, will be restarted" and killed the container. The restart took about 2½ minutes
(the Spring context alone took 32s), so the API was down for about 4 minutes, from 01:52 to about
01:56. The app degraded the way it should: queued writes, cached reads. Nothing was lost.

Inside the app, nothing looked wrong:
- no errors;
- the outbox was empty and the DB pool idle (`poolActive=0`);
- CPU was about 0.035 cores and memory about 440 of 512 MiB;
- the once-a-minute `health-metrics` line still logged at 01:52:18, four seconds *after* the checks
  had started failing.

## Root cause

**Production had no probes configured.** `infra/prod.bicepparam` (worktrac-deploy) never got the
`probes` block that `lower.bicepparam` has, so Azure Container Apps applied its defaults. Those are
TCP checks with 5-second timeouts, and liveness restarts after about 30 seconds without an answer.

`ContainerAppSystemLogs_CL` showed this was not new. The same liveness kill happened on Oct 22,
Oct 23, Nov 14 and Nov 18 (09:35, before that day's In-App Purchase release), as well as Nov 19.
The restarts alert, live since 2026-11-14, was the first thing to surface them.

On a single 0.25 vCPU replica, each kill costs minutes rather than seconds. A cold start there takes
about 2½ minutes, against roughly 20 seconds on a deploy, and there is no second replica to take
traffic in the meantime.

What makes the app stop answering for a minute or so is **not established**. The logs and metrics
show no cause. A small container is a plausible suspect, but nothing here proves it.

`docs/architecture/resilience.md` had recorded on 2026-08-10 that neither app had probes. When
lower later got the app's own probes, that note was not updated, and production was never given
them.

## Fix

worktrac-deploy #93 (production revision 0000058) gives production the app's own probes:

| Probe | Production now | Lower |
|---|---|---|
| Liveness | `GET /actuator/health/liveness`: 10s period, 5s timeout, 6 failures (about a minute) | same |
| Readiness | `GET /actuator/health/readiness`: 5s period, 5s timeout, 6 failures (30s) | 3s / 3s / 5 (15s) |
| Startup | `GET /actuator/health/liveness`: 1s period, up to 240s | same |

**Readiness is deliberately looser on production.** With one replica, taking it out of rotation is
an outage, not a reroute. Neither health group checks the database, so a DB outage still answers
honest 503s rather than causing restarts. Probes run inside a live replica and are not traffic, so
they don't affect lower's scale-to-zero.

## Takeaways

- **An environment with no `probes` gets the platform's defaults, not "no probes".** Those defaults
  are an aggressive TCP liveness check. Production and lower should differ only where a comment
  says why.
- **A stall longer than about a minute still restarts the replica.** If the restarts alert fires
  again, the next lever is resizing production (0.5 vCPU / 1 GiB). That is a cost decision.
- **To find these:** query `ContainerAppSystemLogs_CL` for `failed liveness probe` on
  `worktrac-backend-prod`. Its timestamps are batched, so only the console log's gaps date a stall
  accurately.
