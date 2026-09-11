# Vibe-Dash Phase 1A Cuts: Reports, Recurring Tasks, Reviews

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete three self-contained feature modules (Reports, Recurring Tasks, Reviews) that the project owner does not use, as the first phase of a multi-phase cut-and-sharpen effort. Reduces ~700 LOC of production code, 4 test files, 3 REST endpoint groups, 1 detector, and 4 frontend components.

**Architecture:** One commit per module. Each commit removes server code, schema/migration references where safe, MCP tool references, React components, API client methods, types, and tests in a single atomic change. Schema tables themselves stay in place (they're nullable/orphan and dropping them in SQLite requires migration rewrites that are out of scope here — a follow-up plan can drop them). Type-check + full test run gates every commit.

**Tech Stack:** TypeScript 6, better-sqlite3, Express 5, Vitest, React 19. ESM with `.js` extensions. PowerShell 5.1 default shell.

**Scope notes:**
- This is **Phase 1A** of a larger cut effort. **Not in this plan:** webhooks, integrations, git ingestion, detectors as a whole, team-mode/auth, comments/@mentions/notifications, tags, dependencies, unused views, agent comparison/detail. Those become Phase 1B and Phase 1C.
- Two already-deleted modules (`saved_filters`, `project_templates`) are mentioned in the assessment but require no work — their tables were dropped in migrations 010/011 and no code references them.
- The plan assumes you start on a fresh branch with a clean tree.

---

## Pre-Flight (do once before Task 1)

- [ ] **Verify clean tree and create branch**

```powershell
git status
# Expected: nothing to commit, working tree clean
git checkout -b cuts/phase-1a
```

- [ ] **Verify baseline passes**

```powershell
npm test
# Expected: all tests pass. Record the test count for sanity comparison later.
npm run build
# Expected: vite build + tsc --noEmit both succeed.
```

- [ ] **Confirm `.claude/.last-code-review` is in `.gitignore`**

```powershell
Select-String -Path .gitignore -Pattern "last-code-review"
# Expected: a match. If no match, add the line `.claude/.last-code-review` to .gitignore and commit it as a separate commit before proceeding.
```

---

## Task 1: Remove Reports Module

**Why first:** smallest blast radius — one DB function, one route, one React card, one API method, one test block. Builds confidence in the deletion workflow before touching the more entangled modules.

**Files:**
- Delete: `server/db/reports.ts`
- Delete: `src/components/dashboard/ReportGeneratorCard.tsx`
- Modify: `server/db/index.ts`
- Modify: `server/routes.ts`
- Modify: `src/components/DashboardView.tsx`
- Modify: `src/hooks/useApi.ts`
- Modify: `tests/r4-features.test.ts`

### Step 1.1: Verify exact references before editing

- [ ] **Re-grep to confirm nothing has shifted**

```powershell
# All call sites for generateReport / ReportGeneratorCard / api.generateReport.
# If counts differ from what's listed below, STOP and reconcile before editing.
Select-String -Path server\**\*.ts,src\**\*.ts,src\**\*.tsx,tests\**\*.ts,shared\**\*.ts -Pattern "generateReport|ReportGeneratorCard" -SimpleMatch
```

Expected matches (8 references across 6 files):
- `server/db/reports.ts` — definition (entire file goes away)
- `server/db/index.ts:86` — `export { generateReport } from "./reports.js";`
- `server/routes.ts:62` — import
- `server/routes.ts:760` — POST handler
- `src/components/DashboardView.tsx:12` — import
- `src/components/DashboardView.tsx:210` — JSX render
- `src/components/dashboard/ReportGeneratorCard.tsx` — definition (entire file goes away)
- `src/hooks/useApi.ts:445-451` — `generateReportApi` function
- `src/hooks/useApi.ts:798` — exported as `generateReport`
- `tests/r4-features.test.ts` — "4.4 Report Generation" describe block

If new call sites appear, add them to the edit list before proceeding.

### Step 1.2: Delete the two whole files

- [ ] **Remove server module and React component**

```powershell
git rm server/db/reports.ts
git rm src/components/dashboard/ReportGeneratorCard.tsx
```

### Step 1.3: Remove the re-export from `server/db/index.ts`

- [ ] **Edit `server/db/index.ts`**

Find this line:
```typescript
export { generateReport } from "./reports.js";
```
Delete the entire line.

### Step 1.4: Remove the route registration and import in `server/routes.ts`

- [ ] **Edit `server/routes.ts` — remove the import**

In the import block near line 62, find the line:
```typescript
  generateReport,
```
Delete it (it sits between `getAgentActivityHeatmap,` and `addComment,`).

- [ ] **Edit `server/routes.ts` — remove the route handler**

Find this block (around lines 758–763):
```typescript
  // ─── R4: Reports ───────────────────────────────────────────────────

  router.post("/api/projects/:id/report", (req, res) => {
    const period = (req.body.period as "day" | "week" | "milestone") ?? "week";
    res.json({ report: generateReport(db, req.params.id, period) });
  });

```
Delete the block (including the section comment and the blank line after).

### Step 1.5: Remove the card from `src/components/DashboardView.tsx`

- [ ] **Edit `src/components/DashboardView.tsx`**

Delete the import line (around line 12):
```typescript
import { ReportGeneratorCard } from "./dashboard/ReportGeneratorCard";
```

Find the render line (around line 210) and delete it:
```tsx
      <ReportGeneratorCard projectId={reportProjectId} />
```

After deleting, check whether `reportProjectId` is used by any other JSX in the file:
```powershell
Select-String -Path src\components\DashboardView.tsx -Pattern "reportProjectId"
```
If there are zero remaining matches, also delete the `reportProjectId` state declaration and any imports that fed into it (e.g. a `useState` or hook call that produced it). If it's still used by another component, leave it alone.

### Step 1.6: Remove `generateReportApi` from `src/hooks/useApi.ts`

- [ ] **Edit `src/hooks/useApi.ts`**

Find and delete this function (lines 445–454):
```typescript
async function generateReportApi(projectId: string, period: "day" | "week" | "milestone"): Promise<string> {
  const res = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/report`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ period }),
  });
  if (!res.ok) await throwApiError(res, "generateReport");
  const data = await res.json();
  return data.report;
}
```

Find and delete this line in the exports `useMemo` (around line 798):
```typescript
    generateReport: generateReportApi,
```

### Step 1.7: Delete the test block in `tests/r4-features.test.ts`

- [ ] **Edit `tests/r4-features.test.ts`**

Find the describe block titled `"4.4 Report Generation"` (around lines 151–190) and delete the entire block including its closing `});`. Run:

```powershell
Select-String -Path tests\r4-features.test.ts -Pattern "Report Generation|generateReport"
```
Expected: zero matches.

If the file would become empty (no remaining describe blocks), delete the whole file with `git rm tests/r4-features.test.ts`.

### Step 1.8: Type-check

- [ ] **Run typecheck**

```powershell
npm run build
```
Expected: success. If you see errors like `Cannot find name 'generateReport'` or `'ReportGeneratorCard' is declared but never used`, you missed a reference — grep and fix before moving on.

### Step 1.9: Run tests

- [ ] **Run the test suite**

```powershell
npm test
```
Expected: all tests pass, and the count is exactly the previous count minus the report tests you deleted. If any other test fails, the deletion broke something — investigate before continuing.

### Step 1.10: Smoke test in browser

- [ ] **Run the dev server and verify Dashboard renders**

```powershell
npm run dev
```
Open http://localhost:3000, navigate to the Dashboard view. Expected:
- Dashboard renders without console errors.
- No "Report Generator" card is visible.
- Other Dashboard cards (KPIs, costs, milestones, blockers) still render normally.

Stop the dev server (Ctrl+C) when verified.

### Step 1.11: Static analysis

- [ ] **Run semgrep and PMD CPD on touched files** (per CLAUDE.md global protocol)

```powershell
semgrep --config=auto --error server/db/index.ts server/routes.ts src/components/DashboardView.tsx src/hooks/useApi.ts
npx jscpd server src tests
```
Address any findings before code review.

### Step 1.12: Code review

- [ ] **Invoke superpowers:requesting-code-review on the unstaged diff**

Use the skill to review the diff. Address any findings before committing.

- [ ] **Touch the code-review marker**

```powershell
New-Item -ItemType Directory -Force -Path .claude | Out-Null
New-Item -ItemType File -Force -Path .claude/.last-code-review | Out-Null
```

### Step 1.13: Update STATUS.md if it exists

- [ ] **Check for and update STATUS.md**

```powershell
if (Test-Path docs/superpowers/STATUS.md) { Get-Content docs/superpowers/STATUS.md | Select-Object -Last 30 }
```
If the file exists, append a line noting Phase 1A Task 1 (Reports) completion. If it doesn't exist, skip.

### Step 1.14: Commit

- [ ] **Stage and commit**

```powershell
git add -A
git status
# Verify only the expected files are staged. If unexpected files appear, unstage them.
git commit -m @'
chore: remove unused Reports module

Removes server/db/reports.ts, the POST /api/projects/:id/report
endpoint, the ReportGeneratorCard component, the generateReport
API method, and the "4.4 Report Generation" test block.

Part of Phase 1A cut effort — the Reports feature has no consumer
in the current solo workflow.
'@
```

---

## Task 2: Remove Recurring Tasks

**Why second:** scattered across more files than Reports but each touch is small and the WebSocket/MCP coupling is well-defined. The `recurrence_rule` column on `tasks` stays in place (orphan, nullable, harmless).

**Files:**
- Delete: `server/recurrence.ts`
- Modify: `server/db/tasks.ts` (remove `handleRecurringTaskCompletion` and its `recurrence` import)
- Modify: `server/db/index.ts` (remove export)
- Modify: `server/routes.ts` (remove import + post-completion call)
- Modify: `server/mcp/tools.ts` (remove import + post-completion call + recurrence_rule param in update_task)
- Modify: `shared/schemas.ts` (remove recurrence_rule from Zod schemas if present)
- Modify: `shared/types.ts` (remove recurrence_rule from Task type)
- Modify: `src/hooks/useApi.ts` (remove from updateTask signature)
- Modify: `src/components/task-edit/TaskDateFields.tsx` (remove props + form field)
- Modify: `src/components/TaskEditDrawer.tsx` (remove state + props passthrough)
- Modify: `src/components/TaskCard.tsx` (remove any recurrence indicator)
- Modify: `tests/r5-features.test.ts` (remove recurrence describe blocks)
- Modify: `tests/db.test.ts`, `tests/cli-format.test.ts`, `tests/metrics.test.ts`, `tests/components/test-utils.tsx` (remove `recurrence_rule:` literals)

### Step 2.1: Re-grep to confirm the full reference set

- [ ] **Find every reference**

```powershell
Select-String -Path server\**\*.ts,src\**\*.ts,src\**\*.tsx,tests\**\*.ts,tests\**\*.tsx,shared\**\*.ts -Pattern "recurrence_rule|handleRecurringTaskCompletion|getNextDueDate|recurrence\.js"
```

Expected file list (per pre-plan grep):
- `server/recurrence.ts` (definition — deleted)
- `server/db/tasks.ts` (definition + import)
- `server/db/index.ts` (export)
- `server/db/schema.ts` (column DDL — leave in place)
- `server/db/migrator.ts` (column DDL — leave in place)
- `server/routes.ts` (import + call)
- `server/routes/tasks.ts` (may pass `recurrence_rule` through — investigate)
- `server/mcp/tools.ts` (import + call + param)
- `shared/schemas.ts` (Zod schema field)
- `shared/types.ts` (Task interface field)
- `src/hooks/useApi.ts` (updateTask signature)
- `src/components/TaskEditDrawer.tsx`, `task-edit/TaskDateFields.tsx`, `TaskCard.tsx`
- `tests/r5-features.test.ts`, `db.test.ts`, `cli-format.test.ts`, `metrics.test.ts`, `components/test-utils.tsx`
- `.claude/refactor-tasks.json` and `.claude/insert-refactor-tasks.cjs` — IGNORE these, they're local tooling metadata.
- `docs/archive/specs/2026-03-29-feature-vision-design.md` — IGNORE, archived doc.

If a file appears that's not in the list above, investigate before editing.

### Step 2.2: Delete `server/recurrence.ts`

- [ ] **Remove the file**

```powershell
git rm server/recurrence.ts
```

### Step 2.3: Remove `handleRecurringTaskCompletion` from `server/db/tasks.ts`

- [ ] **Edit `server/db/tasks.ts`**

Delete the recurrence section (lines 246–268, the `// ─── Recurring Tasks ───…` comment through the closing `}` of `handleRecurringTaskCompletion`):

```typescript
// ─── Recurring Tasks ────────────────────────────────────────────────────────

export function handleRecurringTaskCompletion(db: Database.Database, taskId: string): Task | null {
  const task = getTask(db, taskId);
  if (!task || !task.recurrence_rule) return null;

  const nextDueDate = getNextDueDate(task.due_date, task.recurrence_rule);
  const nextStartDate = task.start_date ? getNextDueDate(task.start_date, task.recurrence_rule) : null;
  const nextTask = createTask(db, {
    project_id: task.project_id,
    parent_task_id: task.parent_task_id,
    milestone_id: task.milestone_id,
    assigned_agent_id: task.assigned_agent_id,
    title: task.title,
    description: task.description,
    priority: task.priority,
    due_date: nextDueDate,
    start_date: nextStartDate,
    estimate: task.estimate,
    recurrence_rule: task.recurrence_rule,
  });
  return nextTask;
}
```

After deleting, remove the now-unused import of `getNextDueDate` at the top of the file:
```powershell
Select-String -Path server\db\tasks.ts -Pattern "getNextDueDate|recurrence\.js"
```
Expected: zero matches after the import is removed. If `createTask` still accepts `recurrence_rule` in its input type, leave that alone for now — the column stays in the DB, and other callers that pass `recurrence_rule: null` should keep compiling. The next step audits this.

- [ ] **Check whether `recurrence_rule` is in `CreateTaskInput` / `UpdateTaskInput`**

```powershell
Select-String -Path server\db\tasks.ts -Pattern "recurrence_rule" -Context 1,1
```

If the field is part of `CreateTaskInput` or `UpdateTaskInput`, keep it (callers might pass it; column accepts it). The goal of this plan is to remove the *feature*, not necessarily the column. The column becomes inert orphan data.

### Step 2.4: Remove the export from `server/db/index.ts`

- [ ] **Edit `server/db/index.ts`**

Find this block (lines 21–30) and delete the `handleRecurringTaskCompletion,` line:
```typescript
export {
  createTask,
  getTask,
  listTasks,
  updateTask,
  completeTask,
  searchTasks,
  bulkUpdateTasks,
  handleRecurringTaskCompletion,
} from "./tasks.js";
```
Result:
```typescript
export {
  createTask,
  getTask,
  listTasks,
  updateTask,
  completeTask,
  searchTasks,
  bulkUpdateTasks,
} from "./tasks.js";
```

### Step 2.5: Remove the call site in `server/routes.ts`

- [ ] **Edit `server/routes.ts` — remove import**

In the import block near line 57, find and delete:
```typescript
  handleRecurringTaskCompletion,
```

- [ ] **Edit `server/routes.ts` — remove the post-completion block**

Find the block in the task completion handler (around lines 372–378):
```typescript
    // Handle recurring tasks — create next instance
    if (completed) {
      const nextTask = handleRecurringTaskCompletion(db, completed.id);
      if (nextTask) {
        broadcast({ type: "task_created", payload: nextTask });
      }
    }
```
Delete the block (including the comment and the blank line above it if there is one).

### Step 2.6: Remove the call site in `server/mcp/tools.ts`

- [ ] **Edit `server/mcp/tools.ts` — remove import**

Find and delete `handleRecurringTaskCompletion,` from the import block (around line 20).

- [ ] **Edit `server/mcp/tools.ts` — remove the post-completion block in `complete_task`**

Find the block (around lines 262–266 in the `complete_task` case):
```typescript
// Handle recurring tasks
const nextTask = handleRecurringTaskCompletion(db, completed.id);
if (nextTask) {
  broadcast({ type: "task_created", payload: nextTask });
}
```
Delete it.

- [ ] **Remove `recurrence_rule` from `update_task` and `create_task` MCP tool params if present**

```powershell
Select-String -Path server\mcp\tools.ts -Pattern "recurrence_rule" -Context 1,1
```

For each match in `update_task` or `create_task` tool definitions, delete the line passing the param through (e.g. `recurrence_rule: args.recurrence_rule as string | null | undefined,`). Also remove the field from the Zod input schema for that tool if it's defined in `tools.ts`. If it lives in `shared/schemas.ts`, handle in step 2.7.

### Step 2.7: Remove `recurrence_rule` from shared schemas and types

- [ ] **Edit `shared/schemas.ts`**

```powershell
Select-String -Path shared\schemas.ts -Pattern "recurrence_rule" -Context 1,1
```
For each match, delete the line. These are Zod field definitions like `recurrence_rule: z.string().nullable().optional(),`.

- [ ] **Edit `shared/types.ts`**

Find the `recurrence_rule: string | null;` line in the `Task` interface (around line 42) and delete it.

### Step 2.8: Remove from `src/hooks/useApi.ts`

- [ ] **Edit `src/hooks/useApi.ts`**

Find the `updateTask` signature (around line 130) — remove `| "recurrence_rule"` from the `Pick<…>` union. Example before:
```typescript
async function updateTask(id: string, patch: Pick<Task, "title" | "description" | "status" | "priority" | "due_date" | "recurrence_rule">): Promise<Task>
```
After:
```typescript
async function updateTask(id: string, patch: Pick<Task, "title" | "description" | "status" | "priority" | "due_date">): Promise<Task>
```
(Match exact current key list — there may be more keys than shown.)

### Step 2.9: Remove the recurrence form field from `task-edit/TaskDateFields.tsx`

- [ ] **Edit `src/components/task-edit/TaskDateFields.tsx`**

Remove these props from the component interface (lines 13–14):
```typescript
recurrenceRule: string;
onRecurrenceRuleChange: (v: string) => void;
```

Remove from the destructured props (lines 24–25):
```typescript
recurrenceRule,
onRecurrenceRuleChange,
```

Delete the recurrence FormField JSX block (around lines 57–69) — it's the `<FormField label="Recurrence">` (or similar) section. Find by grepping for `recurrenceRule` in this file and removing the surrounding `<FormField>…</FormField>` block.

### Step 2.10: Remove recurrence state from `TaskEditDrawer.tsx`

- [ ] **Edit `src/components/TaskEditDrawer.tsx`**

Delete the state declaration (around line 38):
```typescript
const [recurrenceRule, setRecurrenceRule] = useState<string>(task.recurrence_rule ?? "");
```

Delete the reset call (around line 79):
```typescript
setRecurrenceRule(task.recurrence_rule ?? "");
```

Delete the payload field (around line 98):
```typescript
recurrence_rule: recurrenceRule || null,
```

Delete the props passed into `<TaskDateFields>` (around lines 168–169):
```tsx
recurrenceRule={recurrenceRule}
onRecurrenceRuleChange={setRecurrenceRule}
```

Verify with:
```powershell
Select-String -Path src\components\TaskEditDrawer.tsx -Pattern "recurren"
```
Expected: zero matches.

### Step 2.11: Remove any recurrence indicator from `TaskCard.tsx`

- [ ] **Edit `src/components/TaskCard.tsx`**

```powershell
Select-String -Path src\components\TaskCard.tsx -Pattern "recurrence" -Context 2,2
```

For each match, delete the conditional JSX that renders a recurrence badge/icon (typically `{task.recurrence_rule && <span>…</span>}`). After deleting, verify zero matches.

### Step 2.12: Remove tests

- [ ] **Edit `tests/r5-features.test.ts`**

Delete the `"2.6 Recurring Tasks"` describe block (around lines 28–65) and the `"getNextDueDate"` describe block (around lines 67–150+). If the file has any remaining tests, keep the file. Otherwise `git rm` it.

- [ ] **Edit other test files that reference `recurrence_rule:`**

```powershell
Select-String -Path tests\db.test.ts,tests\cli-format.test.ts,tests\metrics.test.ts,tests\components\test-utils.tsx -Pattern "recurrence_rule"
```

For each match, delete the line if it's an isolated field in a test fixture (e.g. `recurrence_rule: null,`). If removing breaks the surrounding object literal, fix the trailing comma/syntax.

### Step 2.13: Type-check, test, smoke test

- [ ] **Type-check**

```powershell
npm run build
```
Expected: success. Any "property does not exist on type 'Task'" errors mean you missed a reference.

- [ ] **Run tests**

```powershell
npm test
```
Expected: all pass. The test count drops by however many recurrence tests existed (likely 8–15).

- [ ] **Smoke test**

```powershell
npm run dev
```
Open http://localhost:3000. Open a task in the Task Edit Drawer. Expected:
- Drawer opens without console errors.
- No "Recurrence" field is visible.
- Editing and saving other task fields (title, status, priority, due date) still works.
- Completing a task does not error.

Stop the dev server.

### Step 2.14: Static analysis, code review, marker, commit

- [ ] **Run semgrep + jscpd on touched files**

```powershell
semgrep --config=auto --error server/db/tasks.ts server/db/index.ts server/routes.ts server/mcp/tools.ts shared/schemas.ts shared/types.ts src/hooks/useApi.ts src/components/TaskEditDrawer.tsx src/components/task-edit/TaskDateFields.tsx src/components/TaskCard.tsx
npx jscpd server src tests
```
Address findings.

- [ ] **Code review via superpowers:requesting-code-review**

- [ ] **Touch the marker**

```powershell
New-Item -ItemType File -Force -Path .claude/.last-code-review | Out-Null
```

- [ ] **Update STATUS.md if it exists**

- [ ] **Commit**

```powershell
git add -A
git status
git commit -m @'
chore: remove unused recurring-tasks feature

Removes server/recurrence.ts, handleRecurringTaskCompletion and its
call sites in routes.ts + mcp/tools.ts, recurrence_rule from shared
types/schemas, the Recurrence form field in TaskDateFields, and the
2.6/getNextDueDate test blocks.

The recurrence_rule column on the tasks table is left in place
(nullable, no consumer). Dropping it requires a migration rewrite
that is out of scope for this cut.

Part of Phase 1A cut effort.
'@
```

---

## Task 3: Remove Reviews Module

**Why last:** the most coupled of the three. Touches a dedicated DB module, a separate routes file, two WebSocket event types, a detector (with helper functions in `tier1.ts`), schema/migrator, and a frontend panel embedded in the Task Edit Drawer.

**Files:**
- Delete: `server/db/reviews.ts`
- Delete: `server/routes/reviews.ts`
- Delete: `src/components/task/ReviewPanel.tsx`
- Delete: `tests/reviews.test.ts`
- Delete: `tests/reviews-routes.test.ts`
- Modify: `server/db/index.ts` (remove export)
- Modify: `server/routes.ts` (remove imports + 3 route handlers)
- Modify: `server/routes/index.ts` if it re-exports `reviewRoutes` — investigate
- Modify: `server/detectors/tier1.ts` (remove failing-review detector + ReviewRow + reviewAgeHours + reviewScore)
- Modify: `shared/types.ts` (remove `TaskReview` interface, `ReviewStatus`, WsEventType members `review_created`/`review_updated`, and the corresponding WsEvent union variants)
- Modify: `shared/schemas.ts` (remove `createReviewSchema` / `updateReviewSchema` if present)
- Modify: `src/components/TaskEditDrawer.tsx` (remove ReviewPanel import + render)
- Modify: `src/hooks/useApi.ts` (remove `getReviews`, `createReviewApi`, `updateReviewApi`)
- Modify: `tests/detectors-tier1.test.ts` (remove failing-review tests)

### Step 3.1: Re-grep to map the full surface

- [ ] **Find every reference**

```powershell
Select-String -Path server\**\*.ts,src\**\*.ts,src\**\*.tsx,tests\**\*.ts,tests\**\*.tsx,shared\**\*.ts -Pattern "TaskReview|ReviewPanel|createReview|getReview\b|listReviewsForTask|updateReview|review_created|review_updated|task_reviews|failing-review|ReviewRow|reviewAgeHours|reviewScore|ReviewStatus"
```

Expected file set (per pre-plan grep):
- `server/db/reviews.ts` (definition — deleted)
- `server/routes/reviews.ts` (definition — deleted)
- `server/db/index.ts` (exports)
- `server/routes.ts` (imports + 3 route handlers)
- `server/routes/index.ts` (potentially re-exports `reviewRoutes` — check)
- `server/detectors/tier1.ts` (failing-review detector + helpers)
- `shared/types.ts` (TaskReview, ReviewStatus, WsEventType, WsEvent union)
- `shared/schemas.ts` (Zod schemas)
- `src/components/TaskEditDrawer.tsx` (import + render)
- `src/components/task/ReviewPanel.tsx` (definition — deleted)
- `src/hooks/useApi.ts` (3 functions + 3 exports)
- `tests/reviews.test.ts` (deleted)
- `tests/reviews-routes.test.ts` (deleted)
- `tests/detectors-tier1.test.ts` (review test cases)

Any extra files → investigate before editing.

### Step 3.2: Delete whole files

- [ ] **Remove whole files**

```powershell
git rm server/db/reviews.ts
git rm server/routes/reviews.ts
git rm src/components/task/ReviewPanel.tsx
git rm tests/reviews.test.ts
git rm tests/reviews-routes.test.ts
```

### Step 3.3: Remove DB exports

- [ ] **Edit `server/db/index.ts`**

Find and delete lines 87–88:
```typescript
export { createReview, getReview, listReviewsForTask, updateReview } from "./reviews.js";
export type { CreateReviewInput, UpdateReviewInput } from "./reviews.js";
```

### Step 3.4: Remove the route handlers and imports from `server/routes.ts`

- [ ] **Edit `server/routes.ts` — remove the 4 imports**

In the import block near lines 65–68, delete:
```typescript
  createReview,
  getReview,
  listReviewsForTask,
  updateReview,
```

- [ ] **Edit `server/routes.ts` — remove the 3 route handlers**

Find and delete the entire block (lines 648–705):
```typescript
  // ─── 5.4: Code Review Integration ───────────────────────────────────

  router.get("/api/tasks/:id/reviews", (req, res) => {
    res.json(listReviewsForTask(db, req.params.id));
  });

  router.post("/api/tasks/:id/reviews", (req, res) => {
    /* … entire handler … */
  });

  router.patch("/api/reviews/:id", (req, res) => {
    /* … entire handler … */
  });

```
(Delete the section comment, all three handlers, and the trailing blank line — i.e. everything up to but not including the next `// ─── R3: Notifications` comment.)

### Step 3.5: Check `server/routes/index.ts` for `reviewRoutes` re-export

- [ ] **Edit `server/routes/index.ts` if needed**

```powershell
if (Test-Path server\routes\index.ts) { Get-Content server\routes\index.ts }
```

If you see an `import` or `export` referencing `./reviews.js` or a `reviewRoutes` symbol, remove the line. If there's also a `router.use(reviewRoutes)` somewhere that uses it, remove that too. If `server/routes/index.ts` doesn't exist or doesn't mention reviews, skip this step.

### Step 3.6: Remove the failing-review detector from `tier1.ts`

- [ ] **Edit `server/detectors/tier1.ts`**

Delete these two blocks:

a. The `failing-review` section comment, `ReviewRow` interface, and helper functions (lines 59–79):
```typescript
// ─── failing-review ───────────────────────────────────────────────────────────
// Reviews with status='failed' that have been sitting for > 24 h unresolved.

interface ReviewRow {
  id: string;
  task_id: string;
  reviewer_name: string;
  task_title: string | null;
  updated_at: string;
}

function reviewAgeHours(review: ReviewRow, now: string): number {
  const ms = new Date(now).getTime() - new Date(review.updated_at).getTime();
  return ms / 3_600_000;
}

function reviewScore(ageHours: number): number {
  if (ageHours >= 72) return 90;
  if (ageHours >= 48) return 70;
  return 55;
}
```

b. The `registerDetector({ id: "failing-review", … })` call inside `registerTier1Detectors()` (lines 155–185):
```typescript
  registerDetector({
    id: "failing-review",
    category: "review",
    defaultThreshold: 55,

    predicate({ db, now }: DetectorContext): Match[] {
      const rows = db.prepare(`
        SELECT r.id, r.task_id, r.reviewer_name, r.updated_at, t.title AS task_title
        FROM task_reviews r
        LEFT JOIN tasks t ON r.task_id = t.id
        WHERE r.status = 'failed'
      `).all() as ReviewRow[];

      return rows
        .filter((r) => reviewAgeHours(r, now) >= 24)
        .map((r) => ({
          entityId: r.id,
          entityType: "review" as const,
          label: r.task_title ? `Failed review for "${r.task_title}"` : "Failed review",
          detail: `Reviewer: ${r.reviewer_name}`,
        }));
    },

    score(match, { db, now }: DetectorContext): number {
      const row = db.prepare(
        "SELECT id, task_id, reviewer_name, updated_at FROM task_reviews WHERE id = ?"
      ).get(match.entityId) as ReviewRow | undefined;
      if (!row) return 0;
      return reviewScore(reviewAgeHours({ ...row, task_title: null }, now));
    },
  });
```

After deleting, verify:
```powershell
Select-String -Path server\detectors\tier1.ts -Pattern "review|task_reviews|ReviewRow|reviewScore|reviewAgeHours" -CaseSensitive:$false
```
Expected: zero matches.

- [ ] **Check whether the `"review"` entity type is referenced elsewhere in the detector system**

```powershell
Select-String -Path server\detectors\**\*.ts,shared\**\*.ts -Pattern '"review"' -SimpleMatch
```

If `"review"` is a member of a `EntityType` union type (likely in `server/detectors/types.ts`), leave the union member in place for now — no other detector references it, but removing it from the union could cascade. If you can confirm it's only used by the failing-review detector, remove it from the union.

### Step 3.7: Remove types from `shared/types.ts`

- [ ] **Edit `shared/types.ts` — remove `ReviewStatus` and `TaskReview`**

Find and delete (around line 182):
```typescript
export type ReviewStatus = "pending" | "approved" | "changes_requested" | "failed";
```

Find and delete (around lines 197–207):
```typescript
export interface TaskReview {
  id: string;
  task_id: string;
  reviewer_agent_id: string | null;
  reviewer_name: string;
  status: ReviewStatus;
  comments: string | null;
  diff_summary: string | null;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Edit `shared/types.ts` — remove WsEventType members and WsEvent variants**

```powershell
Select-String -Path shared\types.ts -Pattern "review_created|review_updated" -Context 1,1
```

For each match:
- In the `WsEventType` union (around lines 300–301), delete `"review_created"` and `"review_updated"`.
- In the `WsEvent` discriminated union (around lines 339–340), delete the corresponding variant entries, e.g. `| { type: "review_created"; payload: TaskReview }` and `| { type: "review_updated"; payload: TaskReview }`.

Verify:
```powershell
Select-String -Path shared\**\*.ts -Pattern "TaskReview|ReviewStatus|review_created|review_updated"
```
Expected: zero matches.

### Step 3.8: Remove schemas from `shared/schemas.ts`

- [ ] **Edit `shared/schemas.ts`**

```powershell
Select-String -Path shared\schemas.ts -Pattern "Review" -Context 2,2
```

Delete `createReviewSchema` and `updateReviewSchema` definitions if present. If they're imported and re-exported elsewhere, remove those references too.

### Step 3.9: Remove ReviewPanel from `TaskEditDrawer.tsx`

- [ ] **Edit `src/components/TaskEditDrawer.tsx`**

Delete the import:
```typescript
import { ReviewPanel } from "./task/ReviewPanel";
```

Delete the render block (around lines 192–194 or similar — find by grep):
```tsx
{/* Code Reviews */}
{showReviews && (
  <ReviewPanel taskId={task.id} />
)}
```

If `showReviews` is a local state with no other reference, delete the `useState` and any toggle button that controlled it.

Verify:
```powershell
Select-String -Path src\components\TaskEditDrawer.tsx -Pattern "Review|review"
```
Expected: zero matches.

### Step 3.10: Remove API client methods from `src/hooks/useApi.ts`

- [ ] **Edit `src/hooks/useApi.ts`**

Delete the section comment and three functions (lines 341–372 — find the `updateReviewApi` closing brace and include everything up to it):
```typescript
// ─── 5.4: Code Reviews ──────────────────────────────────────────────────

async function getReviews(taskId: string): Promise<TaskReview[]> {
  const res = await apiFetch(`/api/tasks/${encodeURIComponent(taskId)}/reviews`);
  if (!res.ok) await throwApiError(res, "getReviews");
  return res.json();
}

async function createReviewApi(taskId: string, input: {
  reviewer_name: string;
  status?: ReviewStatus;
  comments?: string | null;
  diff_summary?: string | null;
}): Promise<TaskReview> {
  const res = await apiFetch(`/api/tasks/${encodeURIComponent(taskId)}/reviews`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) await throwApiError(res, "createReview");
  return res.json();
}

async function updateReviewApi(reviewId: string, patch: {
  status?: ReviewStatus;
  comments?: string | null;
  diff_summary?: string | null;
}): Promise<TaskReview> {
  const res = await apiFetch(`/api/reviews/${encodeURIComponent(reviewId)}`, {
    method: "PATCH",
    headers: jsonHeaders(),
    body: JSON.stringify(patch),
  });
  if (!res.ok) await throwApiError(res, "updateReview");
  return res.json();
}
```
(If the actual current `updateReviewApi` body differs from what's shown above, match the actual function body and delete the whole function up to its closing brace.)

Delete the exports from the `useMemo` return (around lines 786–788):
```typescript
getReviews,
createReview: createReviewApi,
updateReview: updateReviewApi,
```

Also remove the now-unused `TaskReview` type import at the top of the file if present.

Verify:
```powershell
Select-String -Path src\hooks\useApi.ts -Pattern "Review|review"
```
Expected: zero matches.

### Step 3.11: Remove review tests from `tests/detectors-tier1.test.ts`

- [ ] **Edit `tests/detectors-tier1.test.ts`**

```powershell
Select-String -Path tests\detectors-tier1.test.ts -Pattern "failing-review|task_reviews|review" -Context 1,1
```

For each test that exercises the failing-review detector (typically a describe or it block titled "failing-review" or "review aging"), delete the entire block. Also delete any helper functions/fixtures that only the deleted tests used.

Verify:
```powershell
Select-String -Path tests\detectors-tier1.test.ts -Pattern "review" -CaseSensitive:$false
```
Expected: zero matches (or only matches in commented-out documentation).

### Step 3.12: Type-check, test, smoke test

- [ ] **Type-check**

```powershell
npm run build
```
Expected: success. Errors like `Cannot find name 'TaskReview'` mean a reference was missed.

- [ ] **Run tests**

```powershell
npm test
```
Expected: all pass. Count drops by however many review tests existed (~10–20).

- [ ] **Smoke test**

```powershell
npm run dev
```
Open http://localhost:3000. Open a task in the Task Edit Drawer. Expected:
- No "Reviews" panel/section visible.
- Drawer opens, edits, saves without console errors.
- HotSpots view (if you still have it — it's slated for deletion in Phase 1B) does not crash even if the `failing-review` detector is gone — there should simply be no `failing-review` results in the list.
- WebSocket connection works (open browser devtools → Network → WS → see no errors about unknown event types).

Stop the dev server.

### Step 3.13: Static analysis, code review, marker, commit

- [ ] **Run semgrep + jscpd**

```powershell
semgrep --config=auto --error server/db/index.ts server/routes.ts server/detectors/tier1.ts shared/types.ts shared/schemas.ts src/components/TaskEditDrawer.tsx src/hooks/useApi.ts
npx jscpd server src tests
```

- [ ] **Code review via superpowers:requesting-code-review**

- [ ] **Touch the marker**

```powershell
New-Item -ItemType File -Force -Path .claude/.last-code-review | Out-Null
```

- [ ] **Update STATUS.md if it exists**

- [ ] **Commit**

```powershell
git add -A
git status
git commit -m @'
chore: remove unused Reviews module

Removes server/db/reviews.ts, server/routes/reviews.ts,
the ReviewPanel component, the failing-review detector in tier1,
TaskReview / ReviewStatus types, review_created / review_updated
WebSocket events, and the reviews + reviews-routes test files plus
review test cases in detectors-tier1.test.ts.

The task_reviews table is left in place. Dropping it requires a
migration rewrite that is out of scope for this cut.

Part of Phase 1A cut effort.
'@
```

---

## Final Verification (do once after all 3 tasks)

- [ ] **Diff summary**

```powershell
git log --oneline main..HEAD
# Expected: 3 commits, one per module.
git diff --stat main..HEAD
# Expected: net negative LOC (probably ~700 lines removed, some additions in barrel files).
```

- [ ] **Full test pass**

```powershell
npm test
npm run build
```
Both must succeed.

- [ ] **End-to-end smoke**

```powershell
npm run dev
```

Verify the full Dashboard + Kanban Board flow:
- Dashboard renders, no console errors, no missing cards.
- Kanban Board renders all milestones and tasks.
- Creating a task via the Task Edit Drawer works.
- Completing a task works.
- WebSocket stays connected.

Stop the dev server.

- [ ] **MCP smoke (since MCP is the user's primary feature)**

```powershell
npm run mcp:stdio
```
The stdio transport should start without errors. Send a `list_tasks` request manually (or via an integration test if one exists) to confirm MCP still works end-to-end.

- [ ] **Push the branch and open a PR (optional — confirm with user first)**

```powershell
git push -u origin cuts/phase-1a
gh pr create --title "chore: Phase 1A cuts — Reports, Recurring Tasks, Reviews" --body @'
## Summary
- Removes 3 unused feature modules (Reports, Recurring Tasks, Reviews)
- ~700 LOC removed across server, client, and tests
- DB tables left in place; column-drop migrations out of scope
- Foundation for Phase 1B (webhooks, integrations, git ingestion, detectors) and Phase 1C (team mode, unused views)

## Test plan
- [ ] `npm test` passes
- [ ] `npm run build` passes
- [ ] Dashboard renders without console errors
- [ ] Kanban Board renders + task creation/completion works
- [ ] MCP stdio transport starts and responds to list_tasks

🤖 Generated with [Claude Code](https://claude.com/claude-code)
'@
```

- [ ] **Update memory if a Phase 1B/1C plan should be queued**

If the user wants the next phase planned now, queue it as a follow-up. Otherwise this plan is complete.

---

## Follow-Up Plans (not in this plan)

These will be written as separate plan files once Phase 1A merges:

- **Phase 1B — Coupled cuts:** Webhooks (outbound), inbound integrations (PagerDuty/Sentry/Grafana), git commit ingestion + close-linked-issues, the detectors subsystem as a whole (after removing HotSpots view), tags, dependencies, comments/@mentions/notifications.
- **Phase 1C — UI cuts:** OrchestrationView, ExecutiveView, ActivityStreamView, TimelineView, AgentComparison, AgentDetailView, team-mode/auth/users (LoginView, UserManagement, `VIBE_TEAM_MODE` branches), milestone daily_stats + milestone_history.
- **Phase 2A — Dashboard sharpening:** Live agent strip ("what's happening now"), burn-rate widget, one-milestone focus.
- **Phase 2B — Kanban sharpening:** Per-card agent attribution (colored border + freshness dot), "just-changed" WebSocket pulse animation.
- **Phase 2C — MCP additions:** `heartbeat(agent_id, current_task_id, status_message)` tool, `get_project_context(project_id)` aggregator tool.
