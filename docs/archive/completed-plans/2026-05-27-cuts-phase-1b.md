# Vibe-Dash Phase 1B Cuts: Git Ingestion, Detectors + HotSpots, Integrations, Webhooks

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove five tightly-related-but-distinct feature modules that the project owner does not use: outbound **Webhooks**, inbound **Integrations** (PagerDuty/Sentry/Grafana/Generic), **Git commit ingestion** (background loop + close-linked-issues), the entire **Detectors** subsystem (Tier 1 + Tier 3), and the **HotSpots** view that consumes detector output. Expected reduction: ~2,700 LOC.

**Architecture:** Five sequential commits, ordered by dependency. Git ingestion goes first because Tier 3 detectors depend on the `commits` table. Tier 3 goes next, then Tier 1 + the rest of the detector subsystem + HotSpots view (these are entangled by the detector registry). Integrations is orthogonal (delete anywhere after #1). Webhooks is last because its coupling is concentrated in `makeBroadcast()` in `server/routes/index.ts` — removing it cleanly requires the other routes to no longer care about webhooks (which they already don't; they just call `broadcast(event)`). Schema tables are left in place as orphans (5 new orphans: `webhooks`, `commits`, `git_integrations`, `git_linked_items`, `milestone_history`); dropping requires migration rewrites and is out of scope.

**Tech Stack:** TypeScript 6, better-sqlite3, Express 5, Vitest, React 19. ESM with `.js` extensions. PowerShell 5.1 default shell.

**Branch baseline assumption:** This plan assumes Phase 1A (PR #105) has merged into `main`, so file references are relative to that state. If it hasn't merged yet, the plan still works — just branch from `cuts/phase-1a` HEAD instead of `main`. The dossier that informed this plan was generated against the post-1A working tree, so line numbers should be reasonably accurate.

**Scope notes:**
- **Not in this plan (still future Phase 1C):** Team mode / auth / users, OrchestrationView, ExecutiveView, ActivityStreamView, TimelineView, AgentComparison/Detail, milestone daily_stats, milestone_history (latter becomes orphan in this plan).
- **Not in this plan (Phase 2):** Dashboard sharpening, Kanban sharpening, MCP additions (heartbeat, get_project_context).
- **No drop of orphan tables** — see follow-up section at the bottom for a Phase 1C+ schema sweep plan.

---

## Pre-Flight (do once before Task 1)

- [ ] **Decide branch base and create branch**

```powershell
# If Phase 1A is merged:
git checkout main
git pull
git checkout -b cuts/phase-1b

# If Phase 1A is still in PR (not yet merged):
git checkout cuts/phase-1a
git pull
git checkout -b cuts/phase-1b
```

- [ ] **Commit the plan file**

```powershell
git add docs/superpowers/plans/2026-05-27-cuts-phase-1b.md
git commit -m "docs: add Phase 1B cuts plan (git ingestion, detectors, HotSpots, integrations, webhooks)"
```

- [ ] **Verify baseline**

```powershell
npm test
# Expected: 524 tests across 40 files (Phase 1A end-state). Record the exact number.
npm run build
# Expected: vite build + 2× tsc --noEmit all succeed.
```

---

## Task 1: Remove Git Commit Ingestion + close-linked-issues

**Why first:** unblocks Tier 3 deletion (Tier 3 detectors depend on the `commits` table). Removes a background `setInterval` loop — operationally the riskiest single piece.

**Files:**
- Delete: `server/db/git-sync.ts`
- Delete: `server/git-sync-service.ts`
- Delete: `server/ingestion/commits.ts`
- Delete: `server/ingestion/gitLog.ts` (and the `server/ingestion/` directory if it becomes empty)
- Delete: `server/db/commits.ts`
- Delete: `src/components/GitSyncSettings.tsx`
- Delete: `src/components/IngestionSettings.tsx` (if it exists separately)
- Delete: `tests/git-sync.test.ts`, `tests/git-log-wrapper.test.ts`, any other commits/git tests
- Modify: `server/index.ts` — remove imports, env vars, detector tier3 import path if it's bundled there, and the `startCommitIngestion()` function + call site
- Modify: `server/routes.ts` and `server/routes/tasks.ts` — remove `closeLinkedIssue` import + call site
- Modify: `server/db/index.ts` — remove re-exports from `./git-sync.js` and `./commits.js`
- Modify: `server/routes/index.ts` if it imports any git-sync route factory
- Modify: `src/hooks/useApi.ts` — remove any git-sync API client methods
- Modify: `src/App.tsx` / `src/store.tsx` — remove any settings panel registration for git sync
- Modify: `shared/types.ts` — remove `GitIntegration`, `GitIntegrationSafe`, `GitLinkedItem` types
- Modify: `shared/schemas.ts` — remove any git-sync Zod schemas

**Leave in place:** the `commits`, `git_integrations`, `git_linked_items` tables in `server/db/schema.ts` and `server/db/migrator.ts`.

### Step 1.1: Re-grep the full reference set

- [ ] **Run these greps and reconcile with the file list above**

```powershell
# Symbols
Select-String -Path server\**\*.ts,src\**\*.ts,src\**\*.tsx,tests\**\*.ts,shared\**\*.ts -Pattern "git-sync|gitLog|isGitRepo|realGitLog|runCommitIngestionOnce|startCommitIngestion|closeLinkedIssue|createGitIntegration|listGitIntegrations|getGitIntegration|deleteGitIntegration|updateLastSynced|upsertLinkedItem|getLinkedItemByExternal|listLinkedItems|getLinkedItemByTaskId|GitIntegration|GitLinkedItem|GitSyncSettings|IngestionSettings|COMMIT_INGEST_ENABLED|COMMIT_INGEST_INTERVAL_MS|GIT_REPO_PATH"

# Env vars on disk
Select-String -Path .env*,docker-compose*.yml,Dockerfile* -Pattern "COMMIT_INGEST|GIT_REPO_PATH"
```

If matches appear in files not listed above, investigate before editing. Skip `docs/`, `.claude/`, `node_modules/`, and the Phase 1A/1B plan files.

### Step 1.2: Stop the background ingestion loop (most important)

- [ ] **Edit `server/index.ts`** — surgical removal of the startup hook

Read `server/index.ts` lines 1–30 and lines ~150–180 to find the exact current text. Specifically remove:

1. Imports (lines 18–19):
```typescript
import { runCommitIngestionOnce } from "./ingestion/commits.js";
import { realGitLog, isGitRepo } from "./ingestion/gitLog.js";
```

2. Env-var declarations (lines 45–47):
```typescript
const COMMIT_INGEST_ENABLED = process.env.COMMIT_INGEST_ENABLED !== "false";
const COMMIT_INGEST_INTERVAL_MS = Number(process.env.COMMIT_INGEST_INTERVAL_MS ?? 300_000);
const GIT_REPO_PATH = process.env.GIT_REPO_PATH ?? process.cwd();
```

3. The `startCommitIngestion()` function and its call (around lines 153–172). Read the actual current text and delete the function definition plus any call (typically `startCommitIngestion()` somewhere later in the file).

After editing, grep `server/index.ts` for `commit|ingest|gitLog|GIT_REPO` — expected zero matches.

### Step 1.3: Delete the source files

- [ ] **Delete files**

```powershell
git rm server/db/git-sync.ts
git rm server/git-sync-service.ts
git rm server/ingestion/commits.ts
git rm server/ingestion/gitLog.ts
git rm server/db/commits.ts
git rm src/components/GitSyncSettings.tsx
if (Test-Path src/components/IngestionSettings.tsx) { git rm src/components/IngestionSettings.tsx }
# Remove the directory if empty
if ((Get-ChildItem server/ingestion -ErrorAction SilentlyContinue | Measure-Object).Count -eq 0) { Remove-Item server/ingestion -Recurse }
```

### Step 1.4: Remove the close-linked-issues call from task completion

- [ ] **Edit `server/routes.ts`** (monolithic)

Find around line 375. The block looks like:
```typescript
// R12.2: Close linked GitHub issue (fire-and-forget)
closeLinkedIssue(db, completed!.id).catch((err) => { … });
```

Delete it. Also delete the `closeLinkedIssue,` import near the top of the file.

- [ ] **Edit `server/routes/tasks.ts`** (refactored)

Likely has the same block. Find and delete the `closeLinkedIssue` import and the call site in the task-completion handler.

After both edits, grep both files for `closeLinkedIssue` — expected zero matches.

### Step 1.5: Remove re-exports from `server/db/index.ts`

- [ ] **Edit `server/db/index.ts`**

Delete the entire block (around lines 116–126 in current state):
```typescript
export {
  createGitIntegration,
  listGitIntegrations,
  getGitIntegration,
  deleteGitIntegration,
  updateLastSynced,
  upsertLinkedItem,
  getLinkedItemByExternal,
  listLinkedItems,
  getLinkedItemByTaskId,
} from "./git-sync.js";
export type { GitIntegration, GitIntegrationSafe, GitLinkedItem } from "./git-sync.js";
```

And the line:
```typescript
export * from "./commits.js";
```

### Step 1.6: Check `server/routes/index.ts` and `server/routes.ts` for git-sync route registration

- [ ] **Grep and remove any git route factory**

```powershell
Select-String -Path server\routes.ts,server\routes\index.ts,server\routes\*.ts -Pattern "git|sync" -CaseSensitive:$false
```

If you find a `gitSyncRoutes` or similar factory imported and used in `routeFactories[]`, remove the import and the array entry.

### Step 1.7: Remove frontend consumers

- [ ] **Edit `src/hooks/useApi.ts`**

Grep for `git|GitIntegration|sync`. For each match that's git-sync-specific (not unrelated identifiers), delete the function and its export. Also remove `GitIntegration`/`GitLinkedItem` type imports if no longer used in the file.

- [ ] **Edit `src/App.tsx` and `src/store.tsx`**

Grep both files for `GitSync|IngestionSettings|gitSync|ingestion`. For each match, remove the registration / state / route. Do NOT remove anything unrelated to git ingestion.

### Step 1.8: Remove shared types/schemas

- [ ] **Edit `shared/types.ts`** — delete `GitIntegration`, `GitIntegrationSafe`, `GitLinkedItem` interfaces.

- [ ] **Edit `shared/schemas.ts`** — delete any `gitSyncSchema` or similar Zod schemas.

After both edits, grep entire repo for `GitIntegration|GitLinkedItem` — expected zero matches in source.

### Step 1.9: Delete tests

- [ ] **Remove test files**

```powershell
git rm tests/git-sync.test.ts
if (Test-Path tests/git-log-wrapper.test.ts) { git rm tests/git-log-wrapper.test.ts }
# Search for any other commit-related tests
Get-ChildItem tests -Filter "*commit*" -Recurse
Get-ChildItem tests -Filter "*git*" -Recurse
```

Delete any other tests that exist solely to exercise the deleted code. If a test file mixes git-sync coverage with other coverage, edit out the git-sync portions.

### Step 1.10: Type-check, test, static analysis

- [ ] **Build + test**

```powershell
npm run build
npm test
```

Expected: build clean. Test count drops by however many git/commit tests existed. Record the new test count.

- [ ] **Static analysis**

```powershell
semgrep --config=auto --error server/index.ts server/routes.ts server/routes/tasks.ts server/db/index.ts shared/types.ts shared/schemas.ts src/hooks/useApi.ts src/App.tsx src/store.tsx
npx jscpd server src tests
```

### Step 1.11: Code review + marker + commit

- [ ] **Invoke `superpowers:requesting-code-review`** on the diff. Address findings.

- [ ] **Touch marker**

```powershell
New-Item -ItemType File -Force -Path .claude/.last-code-review | Out-Null
```

- [ ] **Commit**

```powershell
git add -A
git status
git commit -m @'
chore: remove unused git commit ingestion + close-linked-issues

Removes the commit-ingestion background loop in server/index.ts,
server/db/git-sync.ts, server/ingestion/{commits,gitLog}.ts,
server/git-sync-service.ts, server/db/commits.ts, the
closeLinkedIssue call in the task-completion handler, the
GitSyncSettings/IngestionSettings frontend components, the
GitIntegration/GitLinkedItem shared types, and related tests.

Also removes the COMMIT_INGEST_ENABLED, COMMIT_INGEST_INTERVAL_MS,
and GIT_REPO_PATH env vars.

Leaves orphan tables (commits, git_integrations, git_linked_items)
in the schema; dropping them requires a migration rewrite that is
out of scope.

Part of Phase 1B cut effort.
'@
```

---

## Task 2: Remove Tier 3 Detectors

**Why second:** Tier 3 detectors (unlinked-commit, scope-change, activity-burst) all depend on data sources that Task 1 just removed — they would error on every run if left in place. This task is small (one file + one test file + a removal from a registration call).

**Files:**
- Delete: `server/detectors/tier3.ts`
- Delete: `tests/detectors-tier3.test.ts` (if exists)
- Modify: `server/detectors/index.ts` — remove `registerTier3Detectors` export
- Modify: `server/index.ts` — remove the `registerTier3Detectors()` startup call + its import
- Modify: `shared/types.ts` — narrow `DetectorEntityType` to drop `"commit"` and possibly `"area"` if only tier3 emits it (verify by grep — if `"area"` is used by tier1, keep it)

**Leave in place:** the `milestone_history` table (used only by tier3's scope-change detector → becomes orphan).

### Step 2.1: Grep

- [ ] **Confirm references**

```powershell
Select-String -Path server\**\*.ts,src\**\*.ts,tests\**\*.ts,shared\**\*.ts -Pattern "registerTier3Detectors|tier3|unlinked-commit|scope-change|activity-burst|milestone_history"
```

### Step 2.2: Delete tier3.ts

```powershell
git rm server/detectors/tier3.ts
if (Test-Path tests/detectors-tier3.test.ts) { git rm tests/detectors-tier3.test.ts }
```

### Step 2.3: Edit `server/detectors/index.ts`

- [ ] **Remove tier3 export**

Read the file. Delete the line:
```typescript
export { registerTier3Detectors } from "./tier3.js";
```

### Step 2.4: Edit `server/index.ts`

- [ ] **Remove the startup call**

Find and delete (line 75 in pre-Task-1 state — adjust for what Task 1 left):
```typescript
registerTier3Detectors();
```

Also remove `registerTier3Detectors` from the import on line 17:
```typescript
import { registerTier1Detectors, registerTier3Detectors } from "./detectors/index.js";
```
becomes:
```typescript
import { registerTier1Detectors } from "./detectors/index.js";
```

### Step 2.5: Narrow `DetectorEntityType` in `shared/types.ts`

- [ ] **Verify which entity types only tier3 produces**

After Task 1's deletes, only `tier1.ts` remains as a detector source. Read `server/detectors/tier1.ts` and list every `entityType: "…"` it emits. Likely values: `"blocker"`, `"agent"`. (Phase 1A already removed `"review"`.)

The current union (post-Phase 1A) is:
```typescript
export type DetectorEntityType = "task" | "agent" | "blocker" | "commit" | "milestone" | "area";
```

Remove any value tier1 doesn't produce. Conservative narrowing — if you're unsure whether a non-tier1 caller uses `"task"` or `"milestone"` as a hint, leave them. The tight version after narrowing tier3:
```typescript
export type DetectorEntityType = "agent" | "blocker";
```

But verify by grepping `src/components/HotSpotsView.tsx` icon switch and `server/detectors/types.ts` `EntityType` union — both should agree.

### Step 2.6: Update `server/detectors/types.ts` `EntityType`

- [ ] **Narrow the server-side union to match**

Mirror the same narrowing in `server/detectors/types.ts` so it stays in sync with `shared/types.ts`.

### Step 2.7: Update `HotSpotsView.tsx` icon switch

- [ ] **Edit `src/components/HotSpotsView.tsx`**

Remove every `case` arm in the icon switch for entity types that no longer exist (e.g. `"commit"`, possibly `"milestone"`, `"area"`). The TypeScript narrowing from Step 2.5 will surface dead arms as errors during build.

### Step 2.8: Build, test, commit

- [ ] **Build + test**

```powershell
npm run build
npm test
```

- [ ] **Static analysis on touched files**

```powershell
semgrep --config=auto --error server/detectors/index.ts server/detectors/types.ts server/index.ts shared/types.ts src/components/HotSpotsView.tsx
```

- [ ] **Code review + marker + commit**

```powershell
New-Item -ItemType File -Force -Path .claude/.last-code-review | Out-Null
git add -A
git commit -m @'
chore: remove Tier 3 detectors (depend on deleted commit ingestion)

Tier 3 detectors (unlinked-commit, scope-change, activity-burst)
all read from the commits and milestone_history tables. With commit
ingestion gone in the previous commit, these detectors would error
on every run. Removes:

- server/detectors/tier3.ts and its tests
- The registerTier3Detectors() call in server/index.ts
- DetectorEntityType narrowing in shared/types.ts and
  server/detectors/types.ts
- Now-dead case arms in HotSpotsView icon switch

milestone_history table is left as an orphan.

Part of Phase 1B cut effort.
'@
```

---

## Task 3: Remove Tier 1 Detectors + HotSpots View + Detector Subsystem

**Why third:** Tier 1 still works on its own (blocker-aging, agent-silence read from existing tables), but HotSpotsView is the only consumer and the assessment marked it as unused. Removing the entire detector subsystem at once is cleaner than leaving an unused registry.

**Files:**
- Delete: `server/detectors/registry.ts`
- Delete: `server/detectors/tier1.ts`
- Delete: `server/detectors/types.ts`
- Delete: `server/detectors/index.ts`
- Delete: `server/routes/detectors.ts`
- Delete: `src/components/HotSpotsView.tsx`
- Delete: `tests/detectors.test.ts`, `tests/detectors-tier1.test.ts`
- Modify: `server/index.ts` — remove the `registerTier1Detectors()` call + import
- Modify: `server/routes/index.ts` — remove `detectorRoutes` import + `routeFactories[]` entry
- Modify: `src/components/fleet/PresetSwitcher.tsx` — remove `"hotspots"` preset entry
- Modify: `src/components/fleet/FleetView.tsx` — remove the `fleetPreset === "hotspots"` rendering branch
- Modify: `src/store.tsx` — remove `"hotspots"` from preset state union; ensure the default is still a valid preset
- Modify: `src/hooks/useApi.ts` — remove `getDetectorMatches()` (and any related methods)
- Modify: `shared/types.ts` — remove `DetectorEntityType`, `DetectorMatch`, `ScoredMatch` types entirely

### Step 3.1: Re-grep

- [ ] **Confirm references**

```powershell
Select-String -Path server\**\*.ts,src\**\*.ts,src\**\*.tsx,tests\**\*.ts,shared\**\*.ts -Pattern "registerTier1Detectors|registerDetector|listDetectors|runDetectors|HotSpotsView|hotspots|DetectorMatch|ScoredMatch|DetectorEntityType|detectorRoutes|/api/detectors"
```

Expected file list: roughly the modify list above plus any I missed. Investigate extras.

### Step 3.2: Delete server-side detector files

```powershell
git rm server/detectors/registry.ts
git rm server/detectors/tier1.ts
git rm server/detectors/types.ts
git rm server/detectors/index.ts
git rm server/routes/detectors.ts
if ((Get-ChildItem server/detectors -ErrorAction SilentlyContinue | Measure-Object).Count -eq 0) { Remove-Item server/detectors -Recurse }
```

### Step 3.3: Remove from `server/index.ts`

- [ ] **Edit**

Remove the `registerTier1Detectors()` call near line 74. Remove the entire import (which Task 2 had left as `import { registerTier1Detectors } from "./detectors/index.js";`).

After editing, grep `server/index.ts` for `detector|Tier` — expected zero matches.

### Step 3.4: Remove from `server/routes/index.ts`

- [ ] **Edit `server/routes/index.ts`**

Delete the `detectorRoutes` import (line 24 in the current state):
```typescript
import { detectorRoutes } from "./detectors.js";
```

Delete the entry from `routeFactories[]` (line 81):
```typescript
  detectorRoutes,
```

### Step 3.5: Delete HotSpotsView

```powershell
git rm src/components/HotSpotsView.tsx
```

### Step 3.6: Remove from fleet presets

- [ ] **Edit `src/components/fleet/PresetSwitcher.tsx`**

Grep for `hotspots`. Remove the array/object entry that registers the "hotspots" preset (title, icon, value).

- [ ] **Edit `src/components/fleet/FleetView.tsx`**

Find the rendering switch (around line 51 — verify with grep). Remove the `case "hotspots":` arm or the `fleetPreset === "hotspots"` branch, including the `<HotSpotsView />` element.

- [ ] **Edit `src/store.tsx`**

Find the preset state-type union. Remove `"hotspots"` from it. If the default preset is `"hotspots"`, change it to the next sensible default (`"overview"` or `"board"`).

### Step 3.7: Remove API client

- [ ] **Edit `src/hooks/useApi.ts`**

Grep for `Detector|detector|getDetectorMatches`. Remove `getDetectorMatches()` and its export. Remove `DetectorMatch`/`ScoredMatch` type imports.

### Step 3.8: Remove shared types

- [ ] **Edit `shared/types.ts`**

Delete the entire `DetectorEntityType`, `DetectorMatch`, and `ScoredMatch` type definitions (the narrowed `DetectorEntityType` from Task 2 plus the match/scored types).

### Step 3.9: Delete tests

```powershell
git rm tests/detectors.test.ts
git rm tests/detectors-tier1.test.ts
```

### Step 3.10: Build, test, static analysis, commit

```powershell
npm run build
npm test
semgrep --config=auto --error server/index.ts server/routes/index.ts shared/types.ts src/store.tsx src/hooks/useApi.ts src/components/fleet/FleetView.tsx src/components/fleet/PresetSwitcher.tsx
New-Item -ItemType File -Force -Path .claude/.last-code-review | Out-Null
git add -A
git commit -m @'
chore: remove Tier 1 detectors, HotSpots view, and detector subsystem

The detector subsystem (server/detectors/*) has only one consumer
— the HotSpots fleet preset — which the project owner does not
use. Removes:

- server/detectors/* (registry, tier1, types, index)
- server/routes/detectors.ts and its registration
- src/components/HotSpotsView.tsx
- The hotspots fleet preset (PresetSwitcher, FleetView, store)
- DetectorEntityType, DetectorMatch, ScoredMatch shared types
- getDetectorMatches API client method
- All detector tests

Part of Phase 1B cut effort.
'@
```

---

## Task 4: Remove Inbound Integrations (PagerDuty/Sentry/Grafana/Generic)

**Why fourth:** orthogonal to everything else; could be done anywhere after Task 1. Scheduled here because it's small and unblocks a clean state going into Task 5 (webhooks).

**Files:**
- Delete: `server/routes/integrations.ts`
- Delete: `tests/integrations.test.ts`
- Modify: `server/routes.ts` and/or `server/routes/index.ts` — remove `integrationRoutes` import + registration

### Step 4.1: Grep

```powershell
Select-String -Path server\**\*.ts,src\**\*.ts,tests\**\*.ts -Pattern "integrationRoutes|parsePagerDuty|parseSentry|parseGrafana|parseGeneric|/api/integrations"
```

### Step 4.2: Delete files

```powershell
git rm server/routes/integrations.ts
git rm tests/integrations.test.ts
```

### Step 4.3: Remove route registration

- [ ] **Edit `server/routes.ts`** (monolithic)

Find around line 88 (`import { integrationRoutes } from …`) and around line 121 (`router.use(integrationRoutes…)`). Remove both.

- [ ] **Edit `server/routes/index.ts`** (refactored)

If `integrationRoutes` appears in the import block or `routeFactories[]`, remove both. (Per current state inspection: `routes/index.ts` does NOT include integrationRoutes, suggesting integrations is only mounted via the monolithic `routes.ts`. Verify by grep.)

### Step 4.4: Build, test, static analysis, commit

```powershell
npm run build
npm test
semgrep --config=auto --error server/routes.ts server/routes/index.ts
New-Item -ItemType File -Force -Path .claude/.last-code-review | Out-Null
git add -A
git commit -m @'
chore: remove unused inbound integrations

Removes server/routes/integrations.ts (PagerDuty/Sentry/Grafana/
Generic webhook ingest), its registration in server/routes.ts,
and tests/integrations.test.ts.

No schema or shared types touched — integrations create plain
tasks via the existing createTask flow.

Part of Phase 1B cut effort.
'@
```

---

## Task 5: Remove Outbound Webhooks

**Why last:** The most coupled module, BUT the coupling is concentrated entirely in `makeBroadcast()` in `server/routes/index.ts`. Once that helper is gutted, the rest of the cleanup is mechanical. The ~60 mutation routes that currently call `broadcast(event)` don't need to change — they'll just stop dispatching webhooks.

**Files:**
- Delete: `server/db/webhooks.ts`
- Delete: `server/routes/webhooks.ts`
- Delete: `src/components/WebhookSettings.tsx`
- Delete: any webhook tests (likely `tests/webhooks.test.ts` if it exists — grep)
- Modify: `server/routes/index.ts` — gut `makeBroadcast()`, remove `fireWebhooks` + `webhookRoutes` imports + `webhookRoutes` from `routeFactories[]` + `logger` import if only used by `makeBroadcast`
- Modify: `server/routes.ts` — remove `fireWebhooks` import + 2 direct call sites (lines 111, 206 per dossier)
- Modify: `server/db/index.ts` — remove the webhooks re-export block (lines 78–85)
- Modify: `src/hooks/useApi.ts` — remove `getWebhooks`, `createWebhook`, `updateWebhook`, `deleteWebhook` methods + exports + `Webhook` type import
- Modify: `src/App.tsx` / `src/store.tsx` — remove WebhookSettings panel registration
- Modify: `shared/types.ts` — remove `Webhook` type (verify no other consumer)
- Modify: `shared/schemas.ts` — remove `createWebhookSchema`, `updateWebhookSchema` if present

**Leave in place:** `webhooks` table DDL.

### Step 5.1: Re-grep

```powershell
Select-String -Path server\**\*.ts,src\**\*.ts,src\**\*.tsx,tests\**\*.ts,shared\**\*.ts -Pattern "fireWebhooks|webhookRoutes|createWebhook|listWebhooks|updateWebhook|deleteWebhook|getMatchingWebhooks|WebhookSettings|\bWebhook\b"
```

Expected: ~60+ matches if you count every mutation route that calls `broadcast` — but those calls will NOT change (they call `broadcast(event)` which is the local closure produced by `makeBroadcast`). The only files you actually edit are the ones in the Files list.

To confirm: `broadcast` itself stays. Only `fireWebhooks` and `webhookRoutes` (and the webhook tables, hooks, components, types) go away.

### Step 5.2: Surgical edit of `makeBroadcast()` in `server/routes/index.ts`

- [ ] **Edit `server/routes/index.ts`**

Find the current `makeBroadcast` function (lines 53–60):
```typescript
function makeBroadcast(db: Database.Database) {
  return (event: WsEvent) => {
    wsBroadcast(event);
    fireWebhooks(db, event.type, event.payload).catch((err) => {
      logger.warn({ err, event: event.type }, "webhook dispatch failed");
    });
  };
}
```

Choose ONE of two equivalent refactors:

**Option A (minimal diff):** keep the function shape, just drop the webhook line.
```typescript
function makeBroadcast(_db: Database.Database) {
  return (event: WsEvent) => {
    wsBroadcast(event);
  };
}
```
Then `makeBroadcast(db)` in `createRouter` still works, and the route factory signature `factory(db, broadcast)` is unchanged. The `_db` prefix tells TS the param is intentionally unused.

**Option B (cleaner):** delete `makeBroadcast` entirely and pass `wsBroadcast` directly.
```typescript
// in createRouter, line ~86:
const broadcast = wsBroadcast;
```
This is one fewer indirection but ripples slightly more.

**Recommended:** Option A. It's a 5-line diff in one function and the rest of the file is untouched. Future refactors can simplify further.

After the edit, also remove these from `server/routes/index.ts`:
- The `import { fireWebhooks } from "../db/index.js";` line (line 4)
- The `import { webhookRoutes } from "./webhooks.js";` line (line 17)
- The `webhookRoutes,` entry in `routeFactories[]` (line 74)
- The `import { logger } from "../logger.js";` line IF logger is not used anywhere else in the file (grep first — it's currently used only inside `makeBroadcast`)

### Step 5.3: Remove direct `fireWebhooks` call sites in `server/routes.ts`

- [ ] **Edit `server/routes.ts`** (monolithic)

Per dossier, there are 2 direct `fireWebhooks()` calls at lines 111 and 206 (task_created, project_updated). Grep to find the exact lines:
```powershell
Select-String -Path server\routes.ts -Pattern "fireWebhooks" -Context 2,2
```

For each match, delete the `fireWebhooks(...)` call (typically a one-liner or short block). Then delete `fireWebhooks,` from the import block at the top.

### Step 5.4: Delete files

```powershell
git rm server/db/webhooks.ts
git rm server/routes/webhooks.ts
git rm src/components/WebhookSettings.tsx
if (Test-Path tests/webhooks.test.ts) { git rm tests/webhooks.test.ts }
```

### Step 5.5: Remove DB re-exports

- [ ] **Edit `server/db/index.ts`**

Find the webhooks block (lines 78–85):
```typescript
export {
  createWebhook,
  listWebhooks,
  updateWebhook,
  deleteWebhook,
  getMatchingWebhooks,
  fireWebhooks,
} from "./webhooks.js";
```
Delete the entire block.

### Step 5.6: Remove frontend consumers

- [ ] **Edit `src/hooks/useApi.ts`**

Grep for `Webhook|webhook`. For each match, decide:
- API client methods (`getWebhooks`, `createWebhook`, etc.) → delete the function + the export entry
- Type imports of `Webhook` → delete if no other use in the file remains

- [ ] **Edit `src/App.tsx` / `src/store.tsx`**

Grep both for `WebhookSettings|webhook`. Remove any settings panel registration, route, or state.

### Step 5.7: Remove shared types/schemas

- [ ] **Edit `shared/types.ts`**

Delete the `Webhook` type definition (and `WebhookEvent` if present and only used by webhooks).

- [ ] **Edit `shared/schemas.ts`**

Delete `createWebhookSchema`, `updateWebhookSchema` if present.

### Step 5.8: Build, test, smoke

- [ ] **Build + test**

```powershell
npm run build
npm test
```

Expected: build clean. Tests pass; count drops by however many webhook tests existed.

- [ ] **Smoke the broadcast pipeline**

```powershell
npm run dev
```

Open http://localhost:3000. Create a task in the UI. Open browser devtools → Network → WS — confirm a `task_created` event is broadcast. (This confirms `wsBroadcast` still fires; webhooks are gone but WebSocket sync still works.) Stop the dev server.

### Step 5.9: Static analysis, code review, marker, commit

```powershell
semgrep --config=auto --error server/routes.ts server/routes/index.ts server/db/index.ts shared/types.ts shared/schemas.ts src/hooks/useApi.ts src/App.tsx src/store.tsx
New-Item -ItemType File -Force -Path .claude/.last-code-review | Out-Null
git add -A
git commit -m @'
chore: remove unused outbound webhooks

Removes the webhooks subsystem: server/db/webhooks.ts,
server/routes/webhooks.ts, WebhookSettings.tsx, the Webhook
shared type + Zod schemas, the useApi webhook methods, and
related tests.

Crucially, gutted makeBroadcast() in server/routes/index.ts to
just call wsBroadcast — this was the single point that coupled
every mutation route to the webhook dispatcher. The ~60 mutation
routes are unchanged (they still call broadcast(event)).

webhooks table is left as an orphan.

Part of Phase 1B cut effort.
'@
```

---

## Final Verification + Wrap-Up (do once after all 5 tasks)

### Step F.1: Branch summary

- [ ] **Inspect the branch**

```powershell
git log --oneline main..HEAD
# Expected: 6 commits (plan doc + 5 cut commits).
git diff --stat main..HEAD | tail -1
# Expected: net negative LOC ~2700 (excluding the plan doc).
```

### Step F.2: Update CLAUDE.md project-structure section

- [ ] **Edit `CLAUDE.md`**

Drop these entries from the `server/db/` listing in the Project Structure section:
- `webhooks.ts`
- `git-sync.ts` (if listed — pre-Phase-1A may not have been)

Drop these entries if they're listed:
- `commits.ts` reference
- Any detector or HotSpots reference in the `server/` or `src/components/` section

Also: if a "MCP integrations" or "ingest" line exists describing inbound integrations, remove it.

### Step F.3: Update Environment Variables table in CLAUDE.md

- [ ] **Drop env var rows**

The `## Environment Variables` table lists `PORT`, `DB_PATH`, `VIBE_DASH_DB`, `VIBE_TEAM_MODE`. If it also lists `COMMIT_INGEST_ENABLED`, `COMMIT_INGEST_INTERVAL_MS`, or `GIT_REPO_PATH`, remove those rows.

### Step F.4: Full verification pass

```powershell
npm run build
npm test
# Expected: build clean. Test count substantially lower than baseline.
```

### Step F.5: End-to-end smoke

```powershell
npm run dev
```

Open http://localhost:3000:
- Dashboard renders, no console errors, no missing cards.
- Kanban Board renders all milestones and tasks.
- Task creation + completion works.
- Fleet preset switcher does NOT show "Hotspots" any more.
- No "Webhooks" or "Git Sync" settings tab.
- No "Integrations" or "Git" UI anywhere.
- WebSocket stays connected (Network → WS in devtools).

Stop the dev server.

```powershell
npm run mcp:stdio
```

The MCP stdio transport should start without errors. (No MCP tools were touched in this phase.) Stop it.

### Step F.6: Wrap-up commit + push + PR

```powershell
git add CLAUDE.md
git commit -m @'
chore: Phase 1B wrap-up — refresh CLAUDE.md

Drops project-structure entries for the modules deleted in this
branch (webhooks.ts, detectors, git ingestion, integrations,
HotSpots) and removes COMMIT_INGEST_ENABLED, COMMIT_INGEST_
INTERVAL_MS, and GIT_REPO_PATH from the env vars table.

Orphan tables left in schema for a future migration-sweep PR:
- webhooks
- commits, git_integrations, git_linked_items (git ingestion)
- milestone_history (tier 3 scope-change detector)

(task_reviews remains orphaned from Phase 1A.)

End-state: ~2,700 LOC removed across 5 commits.
'@
git push -u origin cuts/phase-1b
gh pr create --title "chore: Phase 1B cuts — git ingestion, detectors, HotSpots, integrations, webhooks" --body @'
## Summary

Phase 1B of the cut-and-sharpen effort. Removes five tightly-related-but-distinct unused modules:

- **Git commit ingestion** — background ingestion loop + close-linked-issues
- **Tier 3 detectors** — unlinked-commit, scope-change, activity-burst (dependent on the deleted commit ingestion)
- **Tier 1 detectors + the rest of the detector subsystem + HotSpotsView** — only consumer of detector output
- **Inbound integrations** — PagerDuty/Sentry/Grafana/Generic webhook ingest
- **Outbound webhooks** — including the makeBroadcast surgery in server/routes/index.ts

~2,700 LOC removed across 5 commits.

### What is intentionally left in place

Five orphan tables (webhooks, commits, git_integrations, git_linked_items, milestone_history). Dropping them requires a SQLite migration rewrite that is out of scope for this cut. A future schema-sweep PR can address them along with task_reviews and the recurrence_rule column from Phase 1A.

### Plan doc

[docs/superpowers/plans/2026-05-27-cuts-phase-1b.md](docs/superpowers/plans/2026-05-27-cuts-phase-1b.md).

## Test plan

- [ ] `npm test` passes
- [ ] `npm run build` passes
- [ ] Dashboard renders; Fleet preset switcher no longer shows "Hotspots"
- [ ] No Webhooks settings, no Git Sync settings, no Integrations UI
- [ ] WebSocket sync still works after webhooks are removed
- [ ] MCP stdio transport starts and responds

🤖 Generated with [Claude Code](https://claude.com/claude-code)
'@
```

---

## Orphan Tables Created by This Plan

After Phase 1B these tables remain in the schema with no consumer:
- `webhooks` (new — from Task 5)
- `commits` (new — from Task 1)
- `git_integrations` (new — from Task 1)
- `git_linked_items` (new — from Task 1)
- `milestone_history` (new — from Task 2)

Combined with Phase 1A's orphans (`task_reviews` table + `recurrence_rule` column on `tasks`), the next migration sweep should drop 6 tables and 1 column. That's a focused follow-up plan with one task per migration step — recommend writing it after Phase 1C (UI cuts + team mode) is also done, so the migration covers all dead schema in one pass.

---

## Follow-Up Plans (not in this plan)

- **Phase 1C — UI cuts + team mode + auth:** OrchestrationView, ExecutiveView, ActivityStreamView, TimelineView, AgentComparison/Detail, milestone daily_stats, LoginView, UserManagement, every `VIBE_TEAM_MODE` branch in routes.
- **Phase 1D — Schema sweep:** Drop the 6 orphan tables and the `recurrence_rule` column via additive migrations.
- **Phase 2A — Dashboard sharpening:** Live agent strip, burn-rate widget, one-milestone focus.
- **Phase 2B — Kanban sharpening:** Per-card agent attribution, just-changed pulse animation.
- **Phase 2C — MCP additions:** `heartbeat`, `get_project_context`.
