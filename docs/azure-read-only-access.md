# Read-only Azure access for Claude Code

Claude can inspect the lower and production Azure resources — container app status and
revisions, metrics, and logs — but cannot change anything. This document explains how that
boundary is enforced and how to re-establish it on a new machine.

## The model

The real control is **RBAC on a dedicated service principal**, not the permission patterns in
`.claude/settings.json`. A destructive command fails at Azure with a 403 regardless of what
Claude is allowed to type. The permission lists exist to cut prompt noise and to block a couple
of things that RBAC alone wouldn't (switching identity, reading Key Vault secrets).

Three pieces:

1. **A read-only service principal** — `worktrac-claude-readonly`, holding only `Reader`,
   `Monitoring Reader`, and `Log Analytics Reader` at subscription scope.
2. **An isolated Azure CLI profile** — `AZURE_CONFIG_DIR` points Claude's `az` at
   `C:/Users/natha/.azure-claude-ro`, so its login never touches the owner-level session in
   the default `~/.azure`. Without this, `az login --service-principal` would overwrite the
   human's own credentials.
3. **Permission lists** — read verbs allowlisted at user scope (applies in every worktree);
   identity- and secret-touching commands denied at project scope (this repo's
   `.claude/settings.json`).

## Why the deny list is narrow

`Bash(az*)` used to be denied outright, which meant Claude could not look at Azure at all. It is
now replaced by targeted denies:

| Denied | Why |
|---|---|
| `az login` / `az logout` / `az account set` | Prevents Claude re-authenticating as a more privileged identity or switching subscription |
| `az ad *` | No Entra ID / app registration changes |
| `az role *` | No self-granting of additional roles |
| `az keyvault secret*` | Secret *values* stay out of the transcript |

Everything else is governed by the service principal's roles.

## What Reader does *not* cover

Deliberate gaps — don't "fix" these by widening the roles:

- **SQL table data.** RBAC does not grant data-plane access to Azure SQL. Reading rows would
  need a contained database user with `db_datareader`, granted in-database. Not set up, on
  purpose — the app's data is per-person and private.
- **Key Vault secret values.** Requires `Key Vault Secrets User`. Not assigned.
- **Container app log *streaming*.** `az containerapp logs show --follow` is unreliable under
  `Reader`. Query Log Analytics instead (below).

## Re-creating the setup

```bash
SUB=6dd0b198-3ce8-4004-af5c-8d200416a840
TENANT=2a132bad-020f-4f9f-86fa-470d03c0153f

az ad sp create-for-rbac --name worktrac-claude-readonly \
  --role Reader --scopes /subscriptions/$SUB
# note the appId and password from the output

APPID=<appId>
az role assignment create --assignee $APPID --role "Monitoring Reader"    --scope /subscriptions/$SUB
az role assignment create --assignee $APPID --role "Log Analytics Reader" --scope /subscriptions/$SUB

# Log in to the ISOLATED profile, not the default one
AZURE_CONFIG_DIR=C:/Users/natha/.azure-claude-ro \
  az login --service-principal -u $APPID -p <password> --tenant $TENANT
```

The client secret is persisted in that config directory's token cache so the login survives
restarts. It lives only on the host — never in this repo, and never in any Claude-visible
config file.

Then set in `~/.claude/settings.json` (user scope, so it applies inside every worktree):

```json
"env": { "AZURE_CONFIG_DIR": "C:/Users/natha/.azure-claude-ro" }
```

## Reading container app logs

Logs land in Log Analytics, not on the container app. The workspace is `worktrac-logs` in
`worktrac-rg`; its query GUID (`customerId`, which is *not* the resource ID) is:

```
ed5b43a9-96fa-4194-9fb4-0d4b7932a86a
```

Re-derive it if the workspace is ever recreated:

```bash
az monitor log-analytics workspace show \
  --resource-group worktrac-rg --workspace-name worktrac-logs --query customerId -o tsv
```

Query with KQL:

```bash
az monitor log-analytics query --workspace ed5b43a9-96fa-4194-9fb4-0d4b7932a86a \
  --analytics-query \
  "ContainerAppConsoleLogs_CL
   | where ContainerAppName_s == 'worktrac-backend-lower'
   | where TimeGenerated > ago(1h)
   | project TimeGenerated, Log_s
   | order by TimeGenerated desc
   | take 100" -o table
```

`ContainerAppSystemLogs_CL` holds platform events (revision starts, probe failures, scaling)
and is the table to check when the app never came up at all.

Because lower runs `min-replicas=0`, a quiet period shows a `GracefulShutdown` line followed by
a cold start on the next request — that pattern is normal, not a crash.

### The extension

`az monitor log-analytics query` lives in an extension. Without it the command tries to
dynamically install and prompts `Do you want to install it now? (Y/n)`, which fails with
`EOF when reading a line` in a non-interactive shell. Install it explicitly first:

```bash
az extension add --name log-analytics
```

It installs into the `AZURE_CONFIG_DIR` above, so it's per-profile — installing it in the
default profile does not make it available to Claude's, or vice versa.

## Scope note

`Reader` is assigned at **subscription** scope, so it also sees the unrelated
`interactive-timeline-rg` resources in this subscription. If that ever matters, reassign the
three roles at `/subscriptions/<sub>/resourceGroups/worktrac-rg` instead — nothing here depends
on subscription-wide visibility.
