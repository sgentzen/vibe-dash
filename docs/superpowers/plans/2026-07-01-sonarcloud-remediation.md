# SonarCloud Issue Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drive the `sgentzen_vibe-dash` SonarCloud project to zero open issues and zero unreviewed security hotspots, and prevent regressions.

**Architecture:** Most of the 464 open issues are TypeScript/React code smells that mirror well-known ESLint rules (`eslint-plugin-sonarjs`, `eslint-plugin-unicorn`, `eslint-plugin-jsx-a11y`, `typescript-eslint`). The project currently has **no linter at all**. The efficient path is: (1) re-baseline the analysis because it is stale, (2) introduce an ESLint harness that reproduces the Sonar rules locally, (3) auto-fix the large mechanical bucket, (4) hand-fix the security / bug / accessibility / complexity buckets, (5) wire lint + the Sonar quality gate into CI so the count cannot climb again.

**Tech Stack:** TypeScript 6, React 19, Vite 8, Node ≥20 (ESM), Vitest. New dev tooling: ESLint 9 (flat config) + `typescript-eslint`, `eslint-plugin-sonarjs`, `eslint-plugin-unicorn`, `eslint-plugin-jsx-a11y`, `eslint-plugin-react` / `react-hooks`.

## Global Constraints

- **ESM only** — all new config/relative imports use explicit `.js` extensions where applicable; `package.json` has `"type": "module"`, so ESLint flat config file must be `eslint.config.js` using ESM `export default`.
- **Node ≥20**, TypeScript strict, ES2022 target — do not introduce syntax below that floor; auto-fixes such as `node:` protocol imports and `globalThis` are safe on this floor.
- **No behavior changes.** Every task must keep `npm test`, `npm run typecheck`, and `npm run build` green. Sonar cleanups are refactors, not feature work.
- **No secret-looking literals** in code or tests (use `"test-key-placeholder"`), per repo conventions.
- **Every task ends with a commit** using Conventional Commits (`fix:`, `refactor:`, `chore:`, `build:`).
- **Task-completion protocol** (from CLAUDE.md): before each commit run tests + `superpowers:requesting-code-review`; after review, write HEAD SHA to `.claude/.last-code-review`. Run `semgrep --config=auto` on changed files.
- **Baseline authority:** The SonarCloud analysis in hand is dated **2026-05-26** and is stale (≈5 weeks old; several flagged files no longer exist — see Task 0). The authoritative issue list is whatever a **fresh** analysis of current `main` reports. Counts below are directional, from the stale snapshot.

---

## Current Snapshot (stale — 2026-05-26 analysis)

- **Quality gate: PASSING** — it only gates *new code*. The 464 issues + 20 hotspots are almost all in "overall" (pre-existing) code, which is why they accumulate without failing CI.
- **464 open issues:** 319 MINOR, 108 MAJOR, 37 CRITICAL. All are `CODE_SMELL` / `BUG` / one `VULNERABILITY`; no BLOCKERs.
- **20 security hotspots:** all `TO_REVIEW`.
- **Staleness proof:** flagged files `server/detectors/tier3.ts`, `src/components/ExecutiveView.tsx`, `server/utils/resolveDbPath.ts`, and `tests/validateWebhookUrl.test.ts` (16 of the 20 hotspots) **no longer exist** in the current tree. Do not hand-fix files without confirming they still exist.

### Issue buckets (by remediation strategy)

| Bucket | Rules (count) | Strategy |
|---|---|---|
| **A. Security vuln + hotspots** | `tssecurity:S8475` (3), `Web:S5725` (1), `typescript:S5443` (1) + 20 hotspots (`docker:S6471`, `docker:S6470`, `typescript:S2245`, `typescript:S5332`×16, `typescript:S5852`, `typescript:S4036`) | Manual, per-item — Task 2 |
| **B. Bugs / reliability** | `S6551` (4, `[object Object]`), `S1082` (10, mouse w/o keyboard — type BUG), `S2871` (4, sort w/o compare), `S7773` (27, `Number.*`), `S1764` (1), `S6606`/`S2486`/`S6594` (1 each) | Manual + partial autofix — Task 3 |
| **C. Accessibility** | `S6819` (13, semantic HTML vs role), `S6848` (11, handler on non-interactive), `S6847` (1), `S6822` (3), `S6772` (3) | Mostly manual — Task 4 |
| **D. Bulk mechanical (autofix)** | `S6759` (63, readonly props), `S7772` (48, `node:`), `S4325` (32, redundant cast), `S7735` (31, negated cond), `S3358` (28, nested ternary), `S7778` (28, combine calls), `S1128` (17, unused import), `S7764` (16, `globalThis`), `S3863` (12, merge imports), `S4624` (10, nested template), `S6582` (9, optional chain), `S7755` (8, `.at()`), `S1854` (3, dead store), + long-tail 77xx/singletons | `eslint --fix` — Task 5 |
| **E. Complexity refactor** | `S3776` (15, cognitive complexity), `S2004` (15, nested functions >4 deep) | Manual, test-guarded — Task 6 |
| **F. Long tail** | remaining singletons not auto-fixed (`S6479` React key index (3), `S4323`, `S2933`, `S3735` (2), `S1121` (2), `S6660`, `S4043`, etc.) | Manual — Task 7 |
| **G. Regression prevention** | — | CI wiring — Task 8 |

---

## File Structure

- Create: `eslint.config.js` — flat ESLint config reproducing the Sonar rule set (Task 1).
- Create: `docs/superpowers/plans/2026-07-01-sonarcloud-remediation.md` — this file.
- Modify: `package.json` — add `lint`/`lint:fix` scripts + devDependencies (Task 1).
- Modify: `.github/workflows/ci.yml` — add `lint` step + optional Sonar scan (Task 8).
- Modify: source files across `src/`, `server/`, `cli/`, `tests/` — the fixes (Tasks 2–7).
- Modify: `Dockerfile`, `index.html` (Task 2/4).
- Modify: `.gitignore` — add `.claude/.last-code-review` (Task 1, per CLAUDE.md).

---

### Task 0: Re-baseline the analysis (do this first)

**Why:** The snapshot is stale; fixing ghosts wastes effort and the "all issues" target is defined by *current* code.

**Files:** none (analysis + notes only).

- [ ] **Step 1: Trigger a fresh analysis of current `main`.** Preferred: let CI/SonarCloud auto-analysis run on the latest commit (the project uses SonarCloud automatic analysis — there is no scanner step in `ci.yml`). If automatic analysis is enabled, just confirm the latest `analysisDate` via the API below is newer than the last merge. Otherwise, run the scanner locally:

```bash
# Only if automatic analysis is NOT enabled. Requires SONAR_TOKEN.
npx --yes sonarqube-scanner \
  -Dsonar.organization=sgentzen \
  -Dsonar.projectKey=sgentzen_vibe-dash \
  -Dsonar.host.url=https://sonarcloud.io \
  -Dsonar.sources=src,server,cli,shared \
  -Dsonar.tests=tests,e2e \
  -Dsonar.token=$SONAR_TOKEN
```

- [ ] **Step 2: Pull the fresh issue list** (via the SonarCloud MCP `search_sonar_issues_in_projects` with `projects=["sgentzen_vibe-dash"]`, `issueStatuses=["OPEN","CONFIRMED"]`, `ps=500`, paging through all pages) and the fresh hotspots (`search_security_hotspots`, `projectKey=sgentzen_vibe-dash`). Save the raw JSON under `docs/superpowers/plans/sonar-baseline-2026-07-01.json`.

- [ ] **Step 3: Regenerate the bucket table** in this plan from the fresh counts. If a rule/file from the snapshot is gone, strike it; if new ones appeared, slot them into the matching bucket (A–F). Confirm the confirmed-real security items still exist (`src/state/setReducer.ts`, `src/components/TopBar.tsx`, `server/db/path.ts`, `server/mcp/server.ts`, `Dockerfile`, `index.html`, `tests/worktrees.test.ts`).

- [ ] **Step 4: Commit the baseline.**

```bash
git add docs/superpowers/plans/
git commit -m "docs: baseline current SonarCloud issues for remediation"
```

---

### Task 1: Stand up the ESLint harness (report-only, no fixes yet)

**Files:**
- Create: `eslint.config.js`
- Modify: `package.json` (scripts + devDeps)
- Modify: `.gitignore`

**Interfaces:**
- Produces: `npm run lint` (report) and `npm run lint:fix` (autofix) scripts used by every later task and by CI (Task 8).

- [ ] **Step 1: Install the plugins that mirror Sonar's rules.**

```bash
npm install -D eslint@^9 @eslint/js typescript-eslint \
  eslint-plugin-sonarjs eslint-plugin-unicorn \
  eslint-plugin-jsx-a11y eslint-plugin-react eslint-plugin-react-hooks \
  globals
```

- [ ] **Step 2: Create `eslint.config.js`** (flat config). This enables the rule families behind buckets B–F so they are visible and auto-fixable locally.

```js
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import sonarjs from "eslint-plugin-sonarjs";
import unicorn from "eslint-plugin-unicorn";
import jsxA11y from "eslint-plugin-jsx-a11y";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "coverage/**", "*.config.*"] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  sonarjs.configs.recommended,
  unicorn.configs["flat/recommended"],
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      // Sonar parity: cognitive complexity threshold matches SonarCloud default (15).
      "sonarjs/cognitive-complexity": ["warn", 15],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { react, "react-hooks": reactHooks, "jsx-a11y": jsxA11y },
    languageOptions: { globals: globals.browser },
    settings: { react: { version: "detect" } },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      "react/prop-types": "off", // TS handles prop types
    },
  },
  {
    files: ["tests/**/*.ts", "e2e/**/*.ts"],
    rules: { "unicorn/no-null": "off", "sonarjs/no-hardcoded-ip": "off" },
  },
);
```

- [ ] **Step 3: Add scripts to `package.json`.**

```jsonc
"lint": "eslint .",
"lint:fix": "eslint . --fix",
```

- [ ] **Step 4: Add the review marker to `.gitignore`** (CLAUDE.md requirement).

```
.claude/.last-code-review
```

- [ ] **Step 5: Run the linter to confirm it reports (do not fix yet).**

Run: `npm run lint 2>&1 | tail -40`
Expected: a large number of errors/warnings across `src/`, `server/`, `cli/` — this is the local mirror of the Sonar buckets. Confirm no config/parse errors (config errors print `Parsing error` or `Cannot find`).

- [ ] **Step 6: Verify the toolchain is otherwise green.**

Run: `npm run typecheck && npm test`
Expected: PASS (adding ESLint changes no runtime code).

- [ ] **Step 7: Commit the harness.**

```bash
git add eslint.config.js package.json package-lock.json .gitignore
git commit -m "build: add ESLint harness mirroring SonarCloud rule set"
```

---

### Task 2: Security vulnerabilities + hotspots (bucket A)

Fix confirmed items only; skip any whose file no longer exists per Task 0. Each sub-step is independently verifiable.

**Files (confirmed present):** `src/state/setReducer.ts`, `src/components/TopBar.tsx`, `server/db/path.ts`, `server/mcp/server.ts`, `Dockerfile`, `index.html`, `tests/worktrees.test.ts`.

- [ ] **Step 1: `tssecurity:S8475` — browser-storage poisoning (3, HIGH/SECURITY).** In `src/state/setReducer.ts` and `src/components/TopBar.tsx`, every value written to `localStorage`/`sessionStorage` must be validated against an allowlist or schema before write. Pattern:

```ts
const ALLOWED_THEMES = ["light", "dark"] as const;
type Theme = (typeof ALLOWED_THEMES)[number];
function isTheme(v: unknown): v is Theme {
  return typeof v === "string" && (ALLOWED_THEMES as readonly string[]).includes(v);
}
// before write:
if (isTheme(value)) localStorage.setItem("theme", value);
```
Note: commit `b649da6` ("harden browser-storage sinks flagged by SonarCloud") may already cover some of these — confirm against the fresh scan before editing.

- [ ] **Step 2: `Web:S5725` — Subresource Integrity (1) in `index.html`.** For any `<script src>`/`<link>` pointing at a remote origin, add `integrity="sha384-…"` + `crossorigin="anonymous"`, or (preferred here) confirm the asset is bundled locally by Vite and remove the external reference. If everything is local, this issue disappears after re-scan.

- [ ] **Step 3: `typescript:S5443` — publicly writable dir (1) in `tests/worktrees.test.ts`.** Replace any hardcoded `/tmp/...` path with an OS-safe per-test dir:

```ts
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dir = await mkdtemp(join(tmpdir(), "vibe-dash-test-"));
```

- [ ] **Step 4: `typescript:S5852` — ReDoS regex (hotspot) in `server/db/path.ts:19`.** Inspect the regex for catastrophic backtracking (nested quantifiers). Replace with a linear-time alternative or anchor/bound it. If input is trusted (internal path), mark reviewed as *Safe* in SonarCloud with justification instead of code change.

- [ ] **Step 5: `typescript:S2245` — pseudorandom (hotspot) in `server/mcp/server.ts:26`.** If the random value is a security token/session id, switch to `crypto.randomUUID()` / `crypto.getRandomValues`. If it is a non-security nonce/color/jitter, mark the hotspot *Safe* with a one-line justification.

- [ ] **Step 6: `docker:S6471` + `docker:S6470` (hotspots) in `Dockerfile`.** Add a non-root user and narrow the `COPY`:

```dockerfile
RUN addgroup -S app && adduser -S app -G app
USER app
```
Replace `COPY . .` with explicit `COPY` of only needed paths (or rely on `.dockerignore`, which exists). Verify the image still builds: `docker build -t vibe-dash:lint-check .`

- [ ] **Step 7: `typescript:S5332` (http) + `typescript:S4036` (PATH) hotspots.** These were in `tests/validateWebhookUrl.test.ts` and `server/utils/resolveDbPath.ts`, both **deleted**. Confirm gone in the fresh scan; if any survive in renamed files, use `https://` test URLs and set an absolute `PATH` for spawned processes.

- [ ] **Step 8: Verify + review + commit.**

Run: `npm run typecheck && npm test && npm run lint`
Then run `semgrep --config=auto` on the changed files and `superpowers:requesting-code-review`.

```bash
git add -A
git commit -m "fix(security): resolve SonarCloud vulnerabilities and review hotspots"
```

---

### Task 3: Bugs & reliability (bucket B)

**Files:** `src/App.tsx`, `server/mcp/tools.ts` (S6551); JSX components flagged for `S1082`; wherever `.sort()` / global `isNaN`/`parseInt` appear.

- [ ] **Step 1: `typescript:S6551` — `[object Object]` stringification (4).** In `src/App.tsx` and `server/mcp/tools.ts`, wrap objects interpolated into strings/templates with explicit serialization:

```ts
// before: `status ${args.status}`
`status ${typeof args.status === "object" ? JSON.stringify(args.status) : args.status}`
// error objects:
`${lastError instanceof Error ? lastError.message : String(lastError ?? "unknown error")}`
```

- [ ] **Step 2: `typescript:S2871` — `.sort()` without compare fn (4, CRITICAL).** Add an explicit comparator so sorting is not lexicographic on numbers:

```ts
arr.sort((a, b) => a - b);          // numbers
arr.sort((a, b) => a.localeCompare(b)); // strings
```

- [ ] **Step 3: `typescript:S7773` — global `Number` funcs (27).** Autofixable by unicorn `prefer-number-properties`. Run scoped fix:

```bash
npx eslint . --fix --rule '{"unicorn/prefer-number-properties":"error"}'
```
The `isNaN`/`isFinite` conversions also remove a real coercion bug (RELIABILITY impact), so re-check those call sites behave the same.

- [ ] **Step 4: `typescript:S1082` — mouse handler without keyboard handler (10, type BUG).** For each flagged element add the keyboard counterpart or convert to a real `<button>`:

```tsx
<div role="button" tabIndex={0} onClick={fn}
     onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fn(); }} />
```
(Prefer swapping `<div onClick>` for `<button>` where styling allows — also clears related a11y items in Task 4.)

- [ ] **Step 5: `typescript:S1764` (1), `S6594` (1, `RegExp#exec`), `S6606` (1, `??`), `S2486` (1, swallowed catch).** Fix each at the reported location: dedupe the identical sub-expression; use `re.exec(s)` instead of `s.match(re)` in boolean/loop context; replace `||` with `??` where nullish semantics are intended; log or rethrow in the empty `catch`.

- [ ] **Step 6: Verify + review + commit.**

Run: `npm run typecheck && npm test && npm run lint`
Then `superpowers:requesting-code-review`.

```bash
git add -A
git commit -m "fix: resolve SonarCloud reliability bugs (stringification, sort, number APIs, keyboard handlers)"
```

---

### Task 4: Accessibility (bucket C)

**Files:** the flagged JSX components (`src/components/**`: `WebhookSettings.tsx`, `TaskCard.tsx`, `TopBar.tsx`, `NotificationBell.tsx`, `orchestration/AgentComputeHeatmap.tsx`, etc. — confirm via fresh scan).

- [ ] **Step 1: `typescript:S6819` — semantic HTML over ARIA role (13).** Replace `role="…"` with the real element: `role="dialog"` → `<dialog>`; `role="img"` → `<img alt="">`; `role="region"` → `<section aria-label="…">`; `role="button"` → `<button>`. Where a native element is impractical, keep the role but ensure it is justified.

- [ ] **Step 2: `typescript:S6848` — interactive handler on non-interactive element (11).** For each `<div onClick>`/`<span onClick>` either convert to `<button>`/`<a>`, or add `role` + keyboard handler + `tabIndex={0}` (same pattern as Task 3 Step 4). Coordinate with Task 3 to avoid double edits on shared elements.

- [ ] **Step 3: `typescript:S6847` (1), `S6822` (3), `S6772` (3).** Fix at reported locations: remove `tabIndex` from non-interactive/`aria-hidden` elements; add labels/associate `<label htmlFor>`; resolve heading/landmark issues.

- [ ] **Step 4: Verify (incl. existing axe tooling) + review + commit.**

Run: `npm run typecheck && npm test && npm run lint`
(The repo already depends on `@axe-core/react`; if there is an a11y test, run it.) Then `superpowers:requesting-code-review`.

```bash
git add -A
git commit -m "fix(a11y): resolve SonarCloud accessibility findings"
```

---

### Task 5: Bulk mechanical auto-fix (bucket D — the big one)

This clears the majority (~230+) of issues with `eslint --fix`. Do it in **small rule-scoped commits** so review and `git bisect` stay sane, and so an unexpected behavioral change is isolated.

**Files:** across `src/`, `server/`, `cli/`, `shared/`, `tests/`.

- [ ] **Step 1: Safe, purely-syntactic fixes first.** Run each, then `npm run typecheck && npm test` after each before committing:

```bash
# unused & duplicate imports (S1128, S3863)
npx eslint . --fix --rule '{"unused-imports/no-unused-imports":"off"}' # use sonarjs/no-unused-imports or @typescript-eslint/no-unused-vars
npx eslint . --fix   # let full config fix S7772 node:, S7764 globalThis, S7778 combine-calls, S4325 redundant casts, S7755 .at(), S6582 optional-chain, S4624 nested-template, S7735 negated-conditions, S1854 dead-stores, 77xx long-tail
```

- [ ] **Step 2: `typescript:S6759` — readonly React props (63).** Autofixable via `@typescript-eslint`/react rule. If the flat config's fixer covers it, it is already handled by the full `--fix`. Otherwise convert each props type to `Readonly<Props>` (or mark members `readonly`). Verify types still compile.

- [ ] **Step 3: `typescript:S3358` — nested ternaries (28).** ESLint can flag but the fix is often manual (extract to `if`/helper or a lookup). Convert each nested ternary to an early-return helper or a `switch`/map. JSX conditional-render ternaries in *separate* expression containers are exempt (per rule) — verify Sonar still flags before editing.

- [ ] **Step 4: `typescript:S7721` — move functions to highest scope (11).** Move closures that capture nothing to module scope. Manual but mechanical; confirm no captured variable is lost.

- [ ] **Step 5: After each rule-group, verify and commit separately.** Repeat this pattern per group:

Run: `npm run typecheck && npm test && npm run lint`
Expected: tests PASS; lint count drops by the group's size.

```bash
git add -A
git commit -m "refactor: autofix SonarCloud <rule group> (node: imports / globalThis / …)"
```
Suggested commit slices: (a) imports (S1128+S3863), (b) modern-JS unicorn autofixes (S7772/S7764/S7778/S7755/S6582/S4624/S7735 + 77xx), (c) redundant casts S4325, (d) readonly props S6759, (e) nested ternaries S3358, (f) function scope S7721, (g) dead stores S1854.

- [ ] **Step 6: Sanity-check the diff for behavior drift.** `eslint --fix` is safe for these rules, but `globalThis`/`node:`/optional-chaining rewrites touch runtime. Spot-check server startup and a client render:

Run: `npm run build` (must pass) and, if the preview harness is available, load the app and confirm no console errors.

---

### Task 6: Complexity refactors (bucket E — highest maintainability severity)

**Files:** the 15 functions flagged `S3776` and 15 flagged `S2004` (get exact locations from the fresh scan; snapshot pointed at `src/state/wsReducer.ts`, `cli/format.ts`, `cli/index.ts`, `server/routes/*`, `src/App.tsx`, `server/git-sync-service.ts`, `server/plugins/loader.ts`).

**These are genuine refactors — guard each with tests before touching (rule's own pitfall note).**

- [ ] **Step 1: For each flagged function, ensure test coverage exists.** If a function has no test, write a characterization test capturing current behavior first:

```ts
it("wsReducer handles task_created", () => {
  expect(wsReducer(initialState, { type: "task_created", payload: sampleTask }))
    .toEqual(expectedState);
});
```
Run it and confirm PASS against current code.

- [ ] **Step 2: Reduce `S3776` cognitive complexity (28→≤15).** Apply the rule's techniques: extract complex boolean conditions into named predicates, extract branches into helper functions, use early returns to flatten nesting, use `?.`/`??`. One function per commit.

- [ ] **Step 3: Reduce `S2004` nesting (>4 deep).** Extract inner callbacks/functions to named module- or component-scope functions (composes with Task 5 Step 4).

- [ ] **Step 4: After each function, verify behavior unchanged + commit.**

Run: `npm run typecheck && npm test && npm run lint`
Expected: characterization tests still PASS; the function's complexity warning is gone.

```bash
git add -A
git commit -m "refactor: reduce cognitive complexity of <function> (SonarCloud S3776/S2004)"
```

---

### Task 7: Long-tail singletons (bucket F)

**Files:** per fresh scan.

- [ ] **Step 1: Address remaining non-autofixable singletons at their reported locations:** `typescript:S6479` (3, no array index as React `key` — use a stable id), `S4323` (extract repeated union to a named type alias), `S2933` (mark class fields `readonly`), `S3735` (2, remove `void` operator), `S1121` (2, hoist assignment out of the condition), `S6660`, `S4043`, `S6767`, `shelldre:S1192` (1, extract duplicated shell literal in `docker-entrypoint.sh`), plus any stragglers.

- [ ] **Step 2: Re-run the linter to find anything left.**

Run: `npm run lint 2>&1 | tail -20`
Expected: 0 errors (warnings for cognitive-complexity should also be gone after Task 6).

- [ ] **Step 3: Verify + review + commit.**

Run: `npm run typecheck && npm test && npm run build`
Then `superpowers:requesting-code-review`.

```bash
git add -A
git commit -m "refactor: clear remaining SonarCloud long-tail findings"
```

---

### Task 8: Prevent regression (bucket G)

**Files:** `.github/workflows/ci.yml`.

- [ ] **Step 1: Add a lint gate to CI** so new smells fail the build. Insert before the Build step:

```yaml
      - name: Lint
        run: npm run lint
```

- [ ] **Step 2: Tighten the SonarCloud quality gate (SonarCloud UI, not code).** The current gate only measures *new code*, which let 464 issues accumulate. Either (a) keep new-code gate strict (already 0-tolerance on new issues) so the count only goes down as files are touched, or (b) create a custom gate with an *overall* issues condition. Document the decision in the PR description. Confirm the gate is green post-fix:
  - Use MCP `get_project_quality_gate_status` (`projectKey=sgentzen_vibe-dash`) → expect `status: OK`.

- [ ] **Step 3: Confirm the count actually dropped.** Re-run analysis (Task 0 mechanism) and pull `search_sonar_issues_in_projects` total → expect near 0 open issues and `search_security_hotspots` all `REVIEWED`.

- [ ] **Step 4: Update tracking + commit.** Update `STATUS.md` if present and vibe-dash task (if configured). Write the review marker:

```bash
mkdir -p .claude && git rev-parse HEAD > .claude/.last-code-review
git add .github/workflows/ci.yml
git commit -m "ci: add ESLint gate to prevent SonarCloud regressions"
```

- [ ] **Step 5: Open the PR** summarizing buckets fixed, counts before/after, and any hotspots marked *Safe* with justification.

---

## Self-Review Notes

- **Coverage:** Every rule family from the snapshot maps to a task (A→2, B→3, C→4, D→5, E→6, F→7) plus baseline (0) and prevention (8).
- **Staleness handled:** Task 0 re-baselines before any edits; each manual task says "confirm the file still exists / confirm against fresh scan."
- **No silent truncation:** the long tail is explicitly enumerated in Task 7, not hand-waved.
- **Risk:** the only runtime-touching changes are Task 3 (bug fixes — intended), Task 5 auto-fixes (`globalThis`/`node:`/optional-chaining — low risk, spot-checked in 5.6), and Task 6 refactors (test-guarded in 6.1). Everything else is inert.
