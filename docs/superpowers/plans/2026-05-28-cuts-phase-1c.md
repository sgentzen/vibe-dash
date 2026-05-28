# Vibe-Dash Phase 1C Cuts: Ingestion, Intelligence, Fleet Views, Team-Mode/Auth

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the last batch of unused features for a solo Dashboard+Kanban+MCP user: the dead-code **agent ingestion** subsystem, the **Intelligence/AI digest+query** feature, the unused **fleet views** (Executive, Timeline, Orchestration, Activity Stream, Agent Comparison/Detail), and **team-mode / auth / users**. Expected reduction: ~3,400 LOC.

**Architecture:** Five sequential commits ordered least→most coupled. Ingestion first (it's already dead code — not even wired into `routeFactories`). Intelligence next (self-contained). Fleet views third (narrows the `FleetPreset` union and the FleetView render). Auth/team-mode LAST — it's the highest-risk cut because the auth middleware guards the MCP transports (`/sse`, `/messages`, `/mcp`) and every API route. Since auth is already a no-op when no users exist, we remove it entirely (no no-op stub needed). Schema tables stay as orphans (`users`, `ingestion_sources`, plus everything from 1A/1B) for a future Phase 1D schema sweep.

**Tech Stack:** TypeScript 6, better-sqlite3, Express 5, Vitest, React 19. ESM `.js` imports. PowerShell 5.1 default.

**Branch baseline:** Assumes Phase 1B (PR #106) merged into `main`. If not yet merged, branch from `cuts/phase-1b` HEAD instead. The dossier was generated against the post-1B working tree.

**Decisions already made (do not re-ask):**
- **Intelligence: cut entirely** (both the dead anomaly stubs AND the still-live AI digest + natural-language query).
- **Auth: full removal**, not a no-op stub. MCP transports must keep working with no auth middleware at all.

**Scope notes:**
- **Orphan tables created:** `users`, `ingestion_sources` (+ `ingestion_events` if it exists). Combined with 1A/1B orphans, Phase 1D schema sweep will drop: `task_reviews`, `webhooks`, `commits`, `git_integrations`, `git_linked_items`, `milestone_history`, `users`, `ingestion_sources`, and the `recurrence_rule` column.
- **Not in this plan:** Phase 1D (schema sweep), Phase 2 (Dashboard/Kanban sharpening + MCP additions).
- **Kept:** `WorktreeView` and `AgentDashboard` (the "agents" preset stays), all of Dashboard + Kanban, all MCP tools, costs, milestones, blockers, tags, dependencies, comments, notifications, activity (the API — only the *Activity Stream view* goes if it's unused; verify).

---

## Pre-Flight (once)

- [ ] **Branch**
```powershell
git checkout main; if ($?) { git pull }
git checkout -b cuts/phase-1c
```
(If 1B unmerged: `git checkout cuts/phase-1b; git pull; git checkout -b cuts/phase-1c`.)

- [ ] **Commit the plan doc**
```powershell
git add docs/superpowers/plans/2026-05-28-cuts-phase-1c.md
git commit -m "docs: add Phase 1C cuts plan (ingestion, intelligence, fleet views, auth)"
```

- [ ] **Baseline**
```powershell
npm test    # record the count (was 429 at end of Phase 1B)
npm run build
```

---

## Task 1: Remove Dead Agent-Ingestion Subsystem

**Why first:** it's unreachable dead code — `ingestionRoutes` was never added to `routeFactories` in `server/routes/index.ts`, and `IngestionSettings.tsx` was never imported. Lowest risk.

**Files to delete:**
- `src/components/IngestionSettings.tsx`
- `server/ingestion/` — the whole directory (index.ts, auth.ts, normalizer.ts, materializer.ts, and any route factory like `ingestionRoutes`). **Caution:** Phase 1B deleted `server/ingestion/commits.ts` and `gitLog.ts` already; whatever remains here is the agent-ingestion code. Verify each remaining file is ingestion-only before deleting.
- `server/db/ingestion.ts` (the `ingestion_sources` DB helpers) — IF nothing outside the ingestion subsystem imports it (grep first).
- Ingestion tests (e.g. `tests/r11-ingestion.test.ts`, `tests/ingestion*.test.ts` — grep).

**Leave in place:** `ingestion_sources` / `ingestion_events` table DDL (orphan).

### Step 1.1: Map the footprint
```powershell
Select-String -Path server\**\*.ts,src\**\*.ts,src\**\*.tsx,tests\**\*.ts,shared\**\*.ts -Pattern "ingestionRoutes|IngestionSettings|/api/ingest|ingestion_sources|createIngestionSource|listIngestionSources|IngestionSource"
Get-ChildItem server/ingestion -Recurse -ErrorAction SilentlyContinue
```
List every file under `server/ingestion/`. Confirm `ingestionRoutes` is NOT in `server/routes/index.ts` `routeFactories[]` (it isn't, per inspection) and NOT in `server/routes.ts`. If it IS wired anywhere, remove that registration too.

### Step 1.2: Verify db/ingestion.ts consumers
```powershell
Select-String -Path server\**\*.ts -Pattern "from .*db/ingestion|from .*ingestion.js"
```
If the only importers are files you're deleting, `db/ingestion.ts` can go. If `server/db/index.ts` re-exports it, remove that re-export. If anything else uses it, leave it + report.

### Step 1.3: Delete files
```powershell
git rm src/components/IngestionSettings.tsx
git rm -r server/ingestion
# db/ingestion.ts only if Step 1.2 confirmed no external consumers:
if (Test-Path server/db/ingestion.ts) { git rm server/db/ingestion.ts }
```

### Step 1.4: Remove db re-export + shared types
- `server/db/index.ts`: remove any `export ... from "./ingestion.js"` line.
- `shared/types.ts`: remove `IngestionSource`, `IngestionSourceKind` (and related) IF only ingestion used them. Grep first — `IngestionSettings.tsx` referenced `IngestionSourceKind`, but it's being deleted; confirm no other consumer.
- `shared/schemas.ts`: remove ingestion Zod schemas if present.

### Step 1.5: Delete tests
```powershell
Get-ChildItem tests -Filter "*ingest*" -Recurse
# git rm each ingestion-only test file found.
```

### Step 1.6: Build, test, static analysis, commit
```powershell
npm run build
npm test
semgrep --config=auto --error server/db/index.ts shared/types.ts shared/schemas.ts
```
Then code review (`superpowers:requesting-code-review`), then:
```powershell
New-Item -ItemType File -Force -Path .claude/.last-code-review | Out-Null
git add -A; git status
git commit -m @'
chore: remove dead agent-ingestion subsystem

The /api/ingest feature was unreachable dead code — ingestionRoutes
was never registered in routeFactories and IngestionSettings.tsx was
never imported into the UI. Removes server/ingestion/*, the
IngestionSettings component, server/db/ingestion.ts, related shared
types, and ingestion tests.

ingestion_sources table left as an orphan.

Part of Phase 1C cut effort.
'@
```

### Constraints
- DO NOT touch the `ingestion_sources` table DDL.
- DO NOT touch the kept features (costs, milestones, etc.).
- DO NOT push/PR. Re-grep after each edit.

---

## Task 2: Remove Intelligence / AI Digest + Query

**Why second:** self-contained. After Phase 1B the anomaly endpoints are dead stubs; the digest + `/api/intelligence/query` endpoints are live only if `ANTHROPIC_API_KEY` is set. The owner decided to cut all of it.

**Files to delete:**
- `server/intelligence.ts`
- `server/routes/intelligence.ts`
- `tests/intelligence.test.ts` (+ any other intelligence test — grep)
- Any frontend component that calls `/api/intelligence/*` (grep — there may be an "Ask AI" UI; if found, delete it and its registration)

**Edit:**
- `server/routes/index.ts` — remove `import { intelligenceRoutes } from "./intelligence.js";` (line 21) and the `intelligenceRoutes,` entry in `routeFactories[]` (line 73)
- `src/hooks/useApi.ts` — remove any intelligence API methods (e.g. `getIntelligenceStatus`, `runQuery`, `getDigest`, `getAnomalies`)
- `shared/types.ts` / `shared/schemas.ts` — remove intelligence-only types/schemas
- `server/index.ts` — remove any `ANTHROPIC_API_KEY` env handling IF it's only used by intelligence (grep; leave if used elsewhere)

### Step 2.1: Map footprint
```powershell
Select-String -Path server\**\*.ts,src\**\*.ts,src\**\*.tsx,tests\**\*.ts,shared\**\*.ts -Pattern "intelligenceRoutes|/api/intelligence|getDigestAnomalies|shouldSendDigest|buildDigestContext|buildQuerySystemPrompt|callAnthropic|ANTHROPIC_API_KEY|DigestAnomaly|intelligence\.js"
```
Reconcile. Find any "Ask AI" / digest UI component + where it's rendered (TopBar? a view? CommandPalette?).

### Step 2.2: Delete files
```powershell
git rm server/intelligence.ts
git rm server/routes/intelligence.ts
if (Test-Path tests/intelligence.test.ts) { git rm tests/intelligence.test.ts }
# + any intelligence frontend component found in 2.1
```

### Step 2.3: Remove route registration
`server/routes/index.ts`: delete the `intelligenceRoutes` import (line 21) and array entry (line 73).

### Step 2.4: Remove frontend consumers
`src/hooks/useApi.ts`: remove intelligence methods + exports + type imports. Any "Ask AI"/digest UI: remove its render + registration (button/menu/route/keyboard shortcut). Grep `src/` for `intelligence` after.

### Step 2.5: Shared types/schemas + env
`shared/types.ts`: remove `DigestAnomaly` and any intelligence-only types. `shared/schemas.ts`: remove intelligence schemas. `server/index.ts`: if `ANTHROPIC_API_KEY` is read only for intelligence, remove that; if it's used by the MCP server or elsewhere, leave it (grep to decide).

### Step 2.6: Delete tests, build, review, commit
```powershell
npm run build
npm test
semgrep --config=auto --error server/routes/index.ts src/hooks/useApi.ts shared/types.ts shared/schemas.ts
```
Code review, marker, then:
```powershell
New-Item -ItemType File -Force -Path .claude/.last-code-review | Out-Null
git add -A; git status
git commit -m @'
chore: remove Intelligence (AI digest + query + anomaly stubs)

Removes server/intelligence.ts and server/routes/intelligence.ts
(the /api/intelligence/* endpoints: status, anomalies, should-send,
digest, query), their registration, useApi methods, shared types,
and tests. The anomaly endpoints were already dead stubs after the
Phase 1B detector removal; the AI digest + natural-language query
are unused in the solo workflow.

Part of Phase 1C cut effort.
'@
```

### Constraints
- If `ANTHROPIC_API_KEY` is used by the MCP server or any kept feature, DO NOT remove that env handling — only remove intelligence's use of it.
- DO NOT push/PR. Re-grep after each edit.

---

## Task 3: Remove Unused Fleet Views (Executive, Timeline, Orchestration, Activity Stream, Agent Comparison/Detail)

**Why third:** narrows the `FleetPreset` union and simplifies the FleetView render. After this, the fleet has exactly two presets: `overview` (Dashboard only) and `agents` (AgentDashboard + WorktreeView).

**Current FleetView render (for reference):**
```tsx
{fleetPreset === "overview" ? (
  <>
    <DashboardView />
    <ExecutiveView />
  </>
) : fleetPreset === "agents" ? (
  <>
    <AgentDashboard />
    <WorktreeView />
  </>
) : (
  <TimelineView />
)}
```

**Files to delete:**
- `src/components/ExecutiveView.tsx`
- `src/components/TimelineView.tsx` + `src/components/timeline/` (constants.ts, utils.ts, DateHeader.tsx, ResizeHandle.tsx, TaskRow.tsx, and any other file in that dir)
- `src/components/orchestration/` — the whole directory (OrchestrationView.tsx + orchestration.css + HealthScoreGauge, ActiveBlockersPanel, TopAtRiskMilestonesTile, AgentComputeHeatmap, TokenConsumptionChart) — **orphaned since Phase 1B** (only rendered inside the removed HotSpots preset). VERIFY zero importers first.
- `src/components/ActivityStreamView.tsx` + `AgentFeed.tsx` — **only if** they have zero importers / aren't a reachable view (grep — the current FleetPreset union is `overview|agents|timeline`, so there's no "feed" preset; confirm these are orphaned and not reachable some other way).
- `src/components/AgentComparison.tsx`, `src/components/AgentDetailView.tsx` — **only if** zero importers (the dossier says they have none; verify).
- `server/routes/executive.ts`
- `server/db/analytics.ts` — IF `getExecutiveSummary` is its only consumed export (grep). If analytics.ts has other live exports, only remove the executive-specific ones.
- Tests: `tests/executive*.test.ts`, `tests/timeline*.test.ts`, `tests/components/*Executive*`, `tests/components/*Timeline*`, orchestration tests, and `tests/analytics*.test.ts` if analytics is deleted (grep all).

**Edit:**
- `src/components/fleet/FleetView.tsx` — see Step 3.3 (rewrite render to binary)
- `src/components/fleet/PresetSwitcher.tsx` — remove the `timeline` preset entry
- `src/state/types.ts` — narrow `FleetPreset` from `"overview" | "agents" | "timeline"` to `"overview" | "agents"`
- `src/store.tsx` — if any reducer logic references `"timeline"` (e.g. default), confirm default is still valid (`"overview"`)
- `src/App.tsx` — remove the timeline keyboard shortcut (the `gt` hint / `"timeline"` preset mapping); remove any Executive/Orchestration/ActivityStream/AgentComparison shortcuts
- `src/components/CommandPalette.tsx` — remove timeline (and any executive/orchestration/feed) preset commands
- `server/routes/index.ts` — remove `import { executiveRoutes } from "./executive.js";` (line 19) + the `executiveRoutes,` entry (line 70)
- `server/db/index.ts` — remove `getExecutiveSummary` re-export + the `ExecutiveSummary, MilestoneHealth, TeamUtilization, BlockersSummary, TaskVelocity, CostOverview` type re-exports (if analytics.ts is deleted)
- `src/hooks/useApi.ts` — remove `getExecutiveSummary()` + `ExecutiveSummary` type import + any getActivityStream method if ActivityStreamView is removed and nothing else uses it
- `shared/types.ts` — remove `ExecutiveSummary` & related types if defined there (they may live in `server/db/analytics.ts` instead — grep)

### Step 3.1: Map footprint + verify orphans
```powershell
Select-String -Path src\**\*.tsx,src\**\*.ts -Pattern "ExecutiveView|TimelineView|OrchestrationView|ActivityStreamView|AgentFeed|AgentComparison|AgentDetailView"
Select-String -Path server\**\*.ts,src\**\*.ts,tests\**\*.ts -Pattern "executiveRoutes|getExecutiveSummary|/api/executive|ExecutiveSummary|/api/activity-stream|getActivityStream"
```
For each component, list its importers. **Delete only those with zero importers OR whose only importer is FleetView (Executive, Timeline).** If ActivityStream/AgentComparison/AgentDetail turn out to be reachable (e.g. a modal opened from AgentDashboard), STOP and report — they may need to stay or need different handling.

### Step 3.2: Delete view files + backing routes
```powershell
git rm src/components/ExecutiveView.tsx
git rm src/components/TimelineView.tsx
git rm -r src/components/timeline
git rm -r src/components/orchestration
git rm server/routes/executive.ts
# Conditional (only if Step 3.1 confirmed orphaned / zero importers):
# git rm src/components/ActivityStreamView.tsx src/components/AgentFeed.tsx
# git rm src/components/AgentComparison.tsx src/components/AgentDetailView.tsx
# git rm server/db/analytics.ts   (only if getExecutiveSummary is its sole consumed export)
```

### Step 3.3: Rewrite FleetView render
Edit `src/components/fleet/FleetView.tsx`. Remove the `ExecutiveView` and `TimelineView` imports. Change the render to:
```tsx
{fleetPreset === "overview" ? (
  <DashboardView />
) : (
  <>
    <AgentDashboard />
    <WorktreeView />
  </>
)}
```
(With `FleetPreset` narrowed to `"overview" | "agents"`, the `agents` case is the only non-overview option, so the binary is exhaustive.)

### Step 3.4: PresetSwitcher + FleetPreset union
- `src/components/fleet/PresetSwitcher.tsx`: remove the `{ key: "timeline", ... }` entry from the PRESETS array. Keep `overview` and `agents`.
- `src/state/types.ts`: change the `FleetPreset` type to `"overview" | "agents"`.
- `src/store.tsx`: confirm the default `fleetPreset` is `"overview"` (valid). If any reducer branch references `"timeline"`, remove it.

### Step 3.5: App.tsx + CommandPalette shortcuts
- `src/App.tsx`: remove the keyboard shortcut(s) mapping to `"timeline"` (and any to executive/orchestration/feed). Grep `src/App.tsx` for `timeline|executive|orchestration|hotspots|feed`.
- `src/components/CommandPalette.tsx`: remove the corresponding preset commands.

### Step 3.6: Backing route + db + useApi
- `server/routes/index.ts`: remove `executiveRoutes` import (line 19) + array entry (line 70).
- `server/db/index.ts`: remove `getExecutiveSummary` + `ExecutiveSummary`/`MilestoneHealth`/`TeamUtilization`/`BlockersSummary`/`TaskVelocity`/`CostOverview` re-exports (if analytics.ts deleted).
- `src/hooks/useApi.ts`: remove `getExecutiveSummary` + type import. Remove `getActivityStream` ONLY if ActivityStreamView was removed and nothing else calls it.

### Step 3.7: Delete tests, build, smoke, review, commit
```powershell
npm run build
npm test
semgrep --config=auto --error server/routes/index.ts server/db/index.ts src/hooks/useApi.ts src/components/fleet/FleetView.tsx src/components/fleet/PresetSwitcher.tsx src/state/types.ts src/store.tsx src/App.tsx src/components/CommandPalette.tsx
```
**UI smoke (recommended for this task — it's the biggest UI change):** `npm run dev`, open http://localhost:3000, confirm: fleet preset switcher shows only Overview + Agents; Overview renders Dashboard alone (no Executive section below it); Agents renders AgentDashboard + Worktrees; no console errors; no broken keyboard shortcuts. Stop the server.

Code review, marker, then:
```powershell
New-Item -ItemType File -Force -Path .claude/.last-code-review | Out-Null
git add -A; git status
git commit -m @'
chore: remove unused fleet views (Executive, Timeline, Orchestration, etc.)

Narrows the fleet to two presets (overview = Dashboard, agents =
AgentDashboard + Worktrees). Removes:

- ExecutiveView + server/routes/executive.ts + getExecutiveSummary
  (server/db/analytics.ts) + the ExecutiveSummary types
- TimelineView + src/components/timeline/*
- The orphaned src/components/orchestration/* (dead since the HotSpots
  removal in Phase 1B)
- ActivityStreamView/AgentFeed and AgentComparison/AgentDetailView
  (orphaned — zero importers)
- The "timeline" FleetPreset, its PresetSwitcher entry, keyboard
  shortcut, and CommandPalette command

Part of Phase 1C cut effort.
'@
```

### Constraints
- KEEP `DashboardView`, `AgentDashboard`, `WorktreeView` — the two surviving presets depend on them.
- KEEP `AgentEfficiencyCard` on the Dashboard UNLESS it calls the deleted executive API (grep — if it calls `getExecutiveSummary`/`getAgentComparison`, check whether that endpoint survives; AgentComparison endpoint may differ from ExecutiveSummary).
- Delete ActivityStream/AgentComparison/AgentDetail ONLY after confirming zero importers. If reachable, report instead of deleting.
- DO NOT push/PR. Re-grep after each edit.

---

## Task 4: Remove Team Mode / Auth / Users (HIGHEST RISK)

**Why last:** the auth middleware guards the MCP transports AND every API route. Done carefully, with the MCP transports verified working afterward.

**Critical wiring (current state):**
- `server/index.ts:77` — `const mcpAuth = makeAuthMiddleware(db);` used at lines 79 (`/sse`), 90 (`/messages`), 100 (`/mcp`).
- `server/routes/index.ts:89-96` — the `authMiddleware` block wrapping all routes, plus `authLimiter` (lines 40-47) and the `makeAuthMiddleware` import (line 23).

Since auth is a no-op when no users exist, we remove it ENTIRELY (no no-op stub).

**Files to delete:**
- `server/auth.ts`
- `server/db/users.ts`
- `server/routes/users.ts`
- `src/components/LoginView.tsx`
- `src/components/UserManagement.tsx`
- Tests: `tests/auth.test.ts`, `tests/users*.test.ts`, any test exercising `makeAuthMiddleware`/`userRoutes`/login (grep).

**Leave in place:** `users` table DDL (orphan).

### Step 4.1: Map footprint
```powershell
Select-String -Path server\**\*.ts,src\**\*.ts,src\**\*.tsx,tests\**\*.ts,shared\**\*.ts -Pattern "makeAuthMiddleware|VIBE_TEAM_MODE|userRoutes|LoginView|UserManagement|createUser|getUserByKeyHash|listUsers|updateUserRole|deleteUser|rotateApiKey|countUsers|getAuthStatus|validateApiKey|/api/auth|/api/users|isAuthenticated|authEnabled|currentUser|\bUserRole\b|VIBE_DASH_KEY_PEPPER"
```
Reconcile against the file list + edit list below. Investigate any extra consumers.

### Step 4.2: Remove auth from MCP transports (server/index.ts)
Edit `server/index.ts`:
- Remove the import `import { makeAuthMiddleware } from "./auth.js";` (line 11).
- Remove `const mcpAuth = makeAuthMiddleware(db);` (line 77).
- Remove the `mcpAuth` argument from the three transport handlers so they become:
```typescript
app.get("/sse", mcpLimiter, async (req, res) => {
```
```typescript
app.post("/messages", messagesLimiter, async (req, res) => {
```
```typescript
app.all("/mcp", mcpLimiter, async (req, res) => {
```
(Keep the rate limiters; only the `mcpAuth` middleware arg is removed.)

### Step 4.3: Remove auth from the API router (server/routes/index.ts)
Edit `server/routes/index.ts`:
- Remove `import { makeAuthMiddleware } from "../auth.js";` (line 23).
- Remove `import { userRoutes } from "./users.js";` (line 22).
- Remove the `userRoutes,` entry from `routeFactories[]` (line 72).
- Remove the entire `authMiddleware` block (lines 83-96 — the comment + `const authMiddleware = makeAuthMiddleware(db);` + the `router.use((req, res, next) => { ... })` block).
- Remove the `authLimiter` definition (lines 40-47) since it's now unused. (Grep to confirm no other use first.)
- `createRouter` becomes: apiLimiter → route factories loop. Verify it still compiles (no dangling `authMiddleware` reference).

### Step 4.4: Delete server-side files
```powershell
git rm server/auth.ts
git rm server/db/users.ts
git rm server/routes/users.ts
```

### Step 4.5: Remove db re-export + shared types
- `server/db/index.ts`: remove the `createUser, getUserByKeyHash, listUsers, updateUserRole, deleteUser, rotateApiKey, countUsers` re-export block (from `./users.js`).
- `shared/types.ts`: remove `User`, `UserRole` (and any auth types) if only auth used them.
- `shared/schemas.ts`: remove user/auth Zod schemas if present.

### Step 4.6: Remove frontend auth
- `src/components/LoginView.tsx`, `src/components/UserManagement.tsx`: deleted (Step 4.4 covers server; delete these too):
```powershell
git rm src/components/LoginView.tsx
git rm src/components/UserManagement.tsx
```
- `src/App.tsx`: remove the `LoginView` import and the auth gate (`if (authEnabled && !isAuthenticated) return <LoginView />;` or similar) and any auth-status fetch on startup. Remove `UserManagement` render + its entry point (menu/route).
- `src/state/types.ts`: remove `currentUser`, `isAuthenticated`, `authEnabled`, `teamMode` from `AppState`; remove the `SET_AUTH` action from `AppAction`.
- `src/store.tsx`: remove the `SET_AUTH` reducer case and any auth initial-state fields.
- `src/hooks/useApi.ts`: remove `getAuthStatus`, `validateApiKey`, `getStoredApiKey`/`setStoredApiKey` (+ session-storage key logic), and the user-management methods (`listUsers`, `createUser`, etc.).
- Grep `src/` for `isAuthenticated|authEnabled|currentUser|VIBE_TEAM_MODE|LoginView|UserManagement` → zero after.

### Step 4.7: Build, test, MCP smoke (CRITICAL), review, commit
```powershell
npm run build
npm test
```
**MCP smoke is mandatory for this task** — auth was removed from the MCP transports, so verify they still start and respond:
```powershell
# Boot the server on a scratch DB and confirm MCP endpoints are reachable without auth.
$env:PORT="3098"; $env:DB_PATH="./.smoke-1c.db"
$p = Start-Process npx -ArgumentList "tsx","server/index.ts" -PassThru -NoNewWindow -RedirectStandardError ".smoke-1c.log" -RedirectStandardOutput ".smoke-1c.out"
Start-Sleep -Seconds 7
Get-Content .smoke-1c.out, .smoke-1c.log
# /api/projects should be 200 JSON; MCP SSE endpoint should connect (200 / stream) without an API key.
curl.exe -s -o NUL -w "projects: %{http_code}`n" http://localhost:3098/api/projects
curl.exe -s -o NUL -w "mcp POST initialize: %{http_code}`n" -X POST http://localhost:3098/mcp -H "content-type: application/json" -H "accept: application/json, text/event-stream" -d '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2024-11-05\",\"capabilities\":{},\"clientInfo\":{\"name\":\"smoke\",\"version\":\"0\"}}}'
Stop-Process -Id $p.Id -Force
Remove-Item .smoke-1c.db,.smoke-1c.log,.smoke-1c.out -ErrorAction SilentlyContinue
```
Expected: server boots (no `makeAuthMiddleware` crash), `/api/projects` 200, `/mcp` initialize returns 200 (a session) — NOT 401/403. Also run `npm run mcp:stdio` briefly to confirm the stdio transport (which never used HTTP auth) still starts.

Code review, marker, then:
```powershell
New-Item -ItemType File -Force -Path .claude/.last-code-review | Out-Null
git add -A; git status
git commit -m @'
chore: remove team-mode / auth / users

Removes the auth subsystem entirely (it was a no-op when no users
exist, which is the only supported solo mode):

- server/auth.ts, server/db/users.ts, server/routes/users.ts
- LoginView, UserManagement
- The auth middleware from the API router (server/routes/index.ts)
  and from the MCP transports (/sse, /messages, /mcp) in
  server/index.ts — MCP now runs without auth
- authLimiter, userRoutes registration, User/UserRole types, auth
  state in the store, and the useApi auth/user methods
- All VIBE_TEAM_MODE branches

users table left as an orphan.

Part of Phase 1C cut effort.
'@
```

### Constraints
- The MCP transports MUST keep working with NO auth middleware (verified in 4.7). If removing `mcpAuth` breaks a transport, STOP and report.
- DO NOT touch the `users` table DDL.
- Keep `VIBE_DASH_KEY_PEPPER` handling ONLY if something other than auth uses it (grep — it's almost certainly auth-only and should go with auth.ts; the startup warning about it should disappear).
- DO NOT push/PR. Re-grep after each edit.

---

## Final Verification + Wrap-Up + PR

### Step F.1: Branch summary
```powershell
git log --oneline main..HEAD          # expect plan doc + 4 cut commits
git diff --stat main..HEAD | tail -1  # expect ~3,400 LOC removed
```

### Step F.2: CLAUDE.md
- Remove the `VIBE_TEAM_MODE` row from the Environment Variables table.
- Remove any project-structure entries for deleted files (auth.ts, users.ts, intelligence.ts, ExecutiveView, TimelineView, etc. — only those actually listed).
- If the CLAUDE.md "Team mode" note or the `VIBE_TEAM_MODE` explanation paragraph exists, remove/curtail it (single-user is now the only mode).

### Step F.3: Full verification
```powershell
npm run build
npm test
```

### Step F.4: End-to-end smoke
```powershell
npm run dev
```
- Dashboard + Kanban render, no console errors.
- Fleet switcher: only Overview + Agents.
- No Login screen, no User Management, no Webhooks/Git/Integration/Intelligence UI.
- WebSocket connected.
Stop the server. Then `npm run mcp:stdio` to confirm MCP stdio still starts.

### Step F.5: Wrap-up commit + push + PR
```powershell
git add CLAUDE.md
git commit -m @'
chore: Phase 1C wrap-up — refresh CLAUDE.md

Drops VIBE_TEAM_MODE from the env-var table and removes project-
structure entries for the modules deleted this branch (auth, users,
intelligence, executive/timeline/orchestration views, ingestion).

Orphan tables awaiting a Phase 1D schema sweep: task_reviews,
webhooks, commits, git_integrations, git_linked_items,
milestone_history, users, ingestion_sources (+ the recurrence_rule
column on tasks).
'@
git push -u origin cuts/phase-1c
gh pr create --title "chore: Phase 1C cuts — ingestion, intelligence, fleet views, team-mode/auth" --body @'
## Summary

Phase 1C of the cut-and-sharpen effort (follows #105, #106). Removes the last batch of unused features for a solo Dashboard+Kanban+MCP user, in dependency order, each its own commit with two-stage review:

1. Dead agent-ingestion subsystem (was never wired into routeFactories)
2. Intelligence / AI digest + natural-language query (+ the dead anomaly stubs)
3. Unused fleet views — Executive, Timeline, Orchestration, Activity Stream, Agent Comparison/Detail (fleet narrowed to Overview + Agents)
4. Team-mode / auth / users — including removing auth middleware from the MCP transports (MCP now runs unauthenticated, verified)

~3,400 LOC removed.

### Intentionally left as orphans (Phase 1D schema sweep)

users, ingestion_sources tables — plus task_reviews, webhooks, commits, git_integrations, git_linked_items, milestone_history, and the recurrence_rule column from 1A/1B.

Plan: docs/superpowers/plans/2026-05-28-cuts-phase-1c.md

## Test plan
- [ ] npm run build clean
- [ ] npm test passes
- [ ] Dashboard + Kanban render; Fleet switcher = Overview + Agents only
- [ ] No Login / User Management / Intelligence UI
- [ ] MCP /mcp + /sse + stdio all work WITHOUT auth (no 401/403)
- [ ] WebSocket sync intact

> security/snyk fails on a quota limit — skip per prior guidance.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
'@
```

---

## Follow-Up Plans (not in this plan)
- **Phase 1D — Schema sweep:** drop the 8 orphan tables + `recurrence_rule` column via additive migrations (one task per migration step; verify no FK references remain).
- **Phase 2A — Dashboard sharpening:** live agent strip, burn-rate widget, one-milestone focus.
- **Phase 2B — Kanban sharpening:** per-card agent attribution, just-changed pulse.
- **Phase 2C — MCP additions:** `heartbeat`, `get_project_context`.
