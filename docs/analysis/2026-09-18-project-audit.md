# Vibe Dash: full project audit

Date: 2026-09-18
Code audited: `main` at `142674e` (fast-forwarded from `d53d31d` at the start of the session)
Live instance audited: the Docker container serving `127.0.0.1:3001` on the maintainer's machine

## How this was produced

Ten read-only review passes ran in parallel (security, rate limiting, server architecture and performance, data layer and migrations, frontend architecture, accessibility, product fit and documentation, tests/CI/dependencies/hygiene, hand-rolled code versus OSS incumbents, personal and sensitive data), plus a hands-on review of the running dashboard in a browser. Claims that several passes disagreed on, and the highest-severity claims, were re-checked against source before being included. Findings that did not survive checking are listed at the end so nobody re-raises them.

Severity scale: Critical (data loss, remote compromise, or the product's core promise is broken), High (fix soon), Medium (fix when nearby), Low (hygiene). Items marked UNVERIFIED were reasoned from code but not executed.

Not done: the test suite and Playwright were not run; the light theme was not reviewed visually (the browser pane stopped rendering); branch protection settings on GitHub were not inspected.

Process note: partway through the audit another session checked this working tree out to `fix/vitest-coverage-v8-peer-dep` and edited `package.json`. This audit wrote nothing except this file. Line numbers refer to `main`.

## Executive summary

The engineering underneath is better than average for a one-maintainer project. SQL is uniformly parameterised, the client has no HTML-injection surface at all, ingestion is idempotent at the database level, transcript parsing is a true allowlist that never touches prompt content, types and zod schemas are genuinely shared, and the supply-chain controls (pinned actions, `--ignore-scripts` with an allowlist check) are deliberate.

The problems cluster in five places:

1. **The localhost trust boundary is assumed, not enforced.** The native server binds every interface, the WebSocket accepts any Origin, nothing validates Host, and body-less POST routes have no CSRF defence. Any web page the user visits can read the live feed and, with DNS rebinding, read and write everything. One small middleware plus a `listen` host argument closes most of it (SEC-1, SEC-2, SEC-4, SEC-5).
2. **The known SQLite multi-writer hazard is still the documented default.** `docs/MCP-SETUP.md` recommends stdio "for local use", the transport that corrupted this database several times, and no doc mentions corruption. The code enforces nothing: the server, every stdio process and the CLI all open the file read-write and all run migrations (DOC-1, ARCH-1, DATA-5).
3. **Upgrades can destroy data with no snapshot.** Seven migrations drop tables or merge rows irreversibly, a correct backup script exists but nothing calls it, and the post-migration `tasks` rebuild hardcodes a column list and drops all five `tasks` indexes (DATA-1, DATA-2, DATA-3).
4. **The maintainer's own instance does not deliver the wedge.** The running container was built on 2026-08-01, nine days before transcript ingestion merged, so the dashboard the only real user looks at has no observed cost, reads `$0.00`, and returns 404 for `/api/ingest/*`. Even a fresh image would ingest nothing, because the compose file mounts no transcripts directory. Nothing in the UI or `/api/health` reveals the build version (LIVE-1, LIVE-2, LIVE-3).
5. **Test runs pollute real data and nothing can clean it up.** Local Playwright attaches to whatever server is on the port with no `VIBE_DASH_DB` isolation, there is no project delete or archive anywhere (REST, MCP or UI), and the result is 45 `[E2E]` projects out of 51 in the live sidebar, with stale `in_progress` E2E tasks soaking up unrelated commit activity (CI-1, CI-2, PROD-2, UX-3).

Separately, the June refocus (Board as the front door, Fleet retired) has not been started in `src/` beyond dead-code deletion, so the app still opens on Fleet, and a stranger arriving at the README sees no screenshot, no release, no SECURITY.md and no npm package.

## Suggested order of work

Each step is sized to be one or two tasks. Earlier steps make later ones safer.

1. **Close the localhost boundary.** `server.listen(PORT, HOST ?? "127.0.0.1")`; one middleware that rejects unknown `Host` values and cross-site non-GET requests; Origin check in the WebSocket upgrade; `enableDnsRebindingProtection` on the MCP transport; tighten CSP `connect-src` to `'self'`. Fixes SEC-1, SEC-2, SEC-4, SEC-5, SEC-7, most of SEC-10, PII-1 to PII-3.
2. **Clamp `days`** on `/api/costs` (SEC-3). Five-minute fix for a one-request process kill.
3. **Stop the pollution and make it removable.** Temp `VIBE_DASH_DB` and empty `VIBE_DASH_CLAUDE_HOME` in both Playwright `webServer` blocks, `reuseExistingServer: false`, a `globalTeardown`; add project archive (soft delete) over REST, MCP and UI; then archive the 45 junk projects (CI-1 to CI-4, PROD-2).
4. **Make single ownership real.** Reverse the transport recommendation in the docs and add the corruption warning; CLI opens read-only and refuses to migrate; an advisory lock file with a live-PID check in `openDb()`; explicit `busy_timeout` and `BEGIN IMMEDIATE` for migrations (DOC-1, ARCH-1, DATA-5, DATA-15, ARCH-11).
5. **Make upgrades safe.** Snapshot via the existing `VACUUM INTO` logic before any destructive migration; fix `rebuildTasksIfFkStale` (dynamic column list, recreate indexes, real transaction, `foreign_key_check`); guard migration 019; add migration checksums (DATA-1 to DATA-4, DATA-6, DATA-7, DATA-11).
6. **Redeploy and make staleness visible.** Rebuild the image, add the transcripts mount to compose and the docs, expose version and build date in `/api/health` and the UI footer (LIVE-1 to LIVE-3).
7. **Fix the client correctness bugs.** Idempotent `wsReducer` inserts, surfaced mutation errors, a top-level error boundary, the Agent Dashboard fetch storm (FE-1 to FE-5).
8. **Finish the refocus.** Default to Board, reduce the view toggle, retire the Fleet cluster, fold activity and blockers into the task drawer (UX-1, UX-6, FE-16, PROD-4, PROD-7).
9. **Adoption basics.** README screenshot, SECURITY.md, first tagged release with a changelog, decide on npm publication, Windows CI leg (PROD-1, PROD-8, OSS-1, OSS-2, OSS-4).
10. **Data honesty loose ends.** "Since midnight" is UTC midnight; `log_cost` cannot say "unknown"; `handleMutation` swallows exceptions; REST and MCP log activity differently (DATA-8, DATA-10, ARCH-2 to ARCH-6).

## Root-cause chains

**One missing trust check, many findings.** SEC-1, SEC-2, SEC-4, SEC-5, SEC-6, SEC-10, PII-1, PII-2, PII-3, PII-5, RATE-7 and OPS-1 all reduce to "no authentication by design, and the substitute boundary (loopback plus same-origin) is not enforced in code". The Docker path gets it right and documents why; the native path, which the README presents first, does not.

**One file, many owners.** ARCH-1, ARCH-8, ARCH-11, DATA-5, DATA-15, DOC-1 and the project's own corruption history share one cause: every entry point opens SQLite directly and the docs steer users to the entry point that multiplies writers. stdio also cannot broadcast, so it is the worse transport for the live board as well.

**No project lifecycle.** CI-1, CI-2, PROD-2, UX-2, UX-3 and the inflated top-bar counts all follow from projects being create-only. Test isolation stops new junk; archive removes the old.

**Two write paths with hand-rolled side effects.** ARCH-2, ARCH-3, ARCH-5, ARCH-6, ARCH-7 and PROD-6 exist because REST handlers and MCP tools each call `server/db/*` directly and then re-implement validation, activity logging and broadcast. A thin shared service function per mutation would remove the class.

---

## Security

| ID | Sev | Location | Issue | Fix |
|---|---|---|---|---|
| SEC-1 | High | `server/websocket.ts:19-24` | The upgrade handler checks only the path. WebSockets are exempt from same-origin policy, so any page the user visits can open `ws://localhost:3001/ws` and receive every broadcast: full task rows with descriptions, activity text, blocker reasons, spend, and the UUIDs that make SEC-5 practical. | Reject upgrades whose `Origin` is present and not allow-listed. |
| SEC-2 | High | `server/index.ts:47-89`, `:117-150` | No Host or Origin validation on `/api` or `/mcp`. A DNS-rebinding page becomes same-origin and gets full read and write, including every MCP tool. The installed MCP SDK (1.29.0) supports `enableDnsRebindingProtection`, `allowedHosts`, `allowedOrigins`; none is set. | Host allow-list middleware ahead of the router; set the three transport options. |
| SEC-3 | High | `server/routes/costs.ts:49-54`, `server/db/costs.ts:239-251` | `days` is rejected only when `NaN`. `GET /api/costs?groupBy=day&days=100000000` runs a synchronous 100-million-iteration gap-fill loop, freezes the event loop and then exhausts the heap. It is a simple GET, so an `<img>` tag on any web page triggers it. Verified in source. | Clamp to 1..365 at the route and again inside `getCostTimeseries`. |
| SEC-4 | High | `server/index.ts:169` | `server.listen(PORT)` has no host, so native runs bind every interface. `npm start` on cafe Wi-Fi exposes an unauthenticated read/write API and every MCP tool to the LAN. `docker-compose.yml` pins loopback and explains why; the native path and the systemd unit in `docs/self-hosting.md` do not. Verified in source. | Default to `127.0.0.1`; document `HOST=0.0.0.0` as the deliberate opt-in. |
| SEC-5 | Medium | `routes/ingest.ts:39`, `tasks.ts:142`, `blockers.ts:30`, `milestones.ts:60,88` | JSON-body routes are incidentally protected by preflight, but handlers that ignore the body are not. A cross-origin form POST can trigger transcript scans, and with UUIDs from SEC-1 can complete tasks, resolve blockers and complete milestones. | Reject non-GET requests whose `Sec-Fetch-Site` is `cross-site` or whose `Origin` is foreign. |
| SEC-6 | Medium | `server/index.ts:115`, `:131-144` | The MCP HTTP session map has no idle timeout, sweep or size cap. Each `initialize` without a `DELETE` retains a transport, an `McpServer` and an `agents` row. | `lastSeen` per entry, an `unref`'d sweep, a hard cap. |
| SEC-7 | Medium | `server/index.ts:55` | CSP `connect-src` lists bare `ws:` and `wss:`, which match every host. It is the one hole in an otherwise tight policy. | `connectSrc: ["'self'"]`; CSP3 `'self'` covers the same-origin WebSocket. |
| SEC-8 | Medium | `server/mcp/tools.ts:139-160,323`, `server/db/projectContext.ts:16-41` | Agent-written titles, descriptions, activity messages and blocker reasons are returned verbatim to other agents with no untrusted-data framing. The board is a cross-agent prompt-injection channel: an injected agent files a blocker whose reason carries instructions, and the next agent reads it as board metadata in `get_project_context`. | Delimit agent-authored free text in tool results and say in the three tool descriptions that it is data, never instructions. |
| SEC-9 | Low | `docs/self-hosting.md` (team agent configuration) | Recommends `https://alice:${VIBE_DASH_PASSWORD}@host/mcp`. Userinfo lands in proxy access logs, client debug output and the expanded `.mcp.json`. | Recommend an `Authorization` header sourced from the environment. |
| SEC-10 | Low | `server/routes/otlp.ts:58-79` | `/v1/metrics` takes no credential and cost rows are never deleted by design, so poisoned spend is permanent with no UI to find or remove it. The ingest layer itself is well hardened. | Put it behind the SEC-2 check; optional `VIBE_DASH_OTLP_TOKEN` shared secret. |
| SEC-11 | Low | dev dependency tree | `npm audit --omit=dev` is clean across 155 production dependencies. The full tree has one high: `js-yaml` 4.3.1 (GHSA-2883-xcg3-v3hh) via eslint. Build surface only. | `npm audit fix` or an `overrides` pin. |

Checked and clean: SQL injection (every interpolation is a constant or a statically built fragment), shell execution (none in `server/`, `cli/`, `src/`), `eval` or non-JSON deserialisation, path traversal (`POST /api/ingest/paths` stores a string and only prefix-matches it), SSRF (the server makes no outbound requests), XSS (no `dangerouslySetInnerHTML`, no markdown renderer, no data-built `href`), secrets in tracked files, open redirects, gzip bombs against the body limits.

## Rate limiting

Every route sits under the global `apiLimiter` (10000 per 15 minutes) and eleven routes have tighter limiters, so nothing is wholly unprotected. The full route table is in the pass output; the gaps are about shape.

| ID | Sev | Location | Issue | Fix |
|---|---|---|---|---|
| RATE-1 | High | `server/index.ts` (no `trust proxy`), `docs/self-hosting.md:22,132-134` | The docs tell operators to front the app with a reverse proxy, but `trust proxy` is never set, so every client collapses into one bucket keyed on the proxy address. UNVERIFIED: express-rate-limit 7 may also throw `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` once a proxy adds the header. | Configurable `trust proxy`, documented beside the proxy instructions. |
| RATE-2 | Medium | `server/routes/tasks.ts:78` | `PATCH /api/tasks/bulk` has an unbounded `task_ids` array and only the blanket limiter, although one request can rewrite thousands of rows and fan out a broadcast each. | Mutation-sized limiter and a cap on `task_ids.length`. |
| RATE-3 | Medium | blockers, worktrees, milestones, tasks, projects, dependencies POST/PATCH | `server/CLAUDE.md` says every route gets a limiter, but CRUD mutations rely on the blanket, which allows about 11 writes a second. | Apply a shared mutation limiter, or document the blanket as the intended policy. |
| RATE-6 | Medium | all limiters | In-memory store: counters reset on restart and would multiply under clustering. Fine while single-process; undocumented. | Note the assumption in `server/CLAUDE.md`. |
| RATE-7 | Medium | `server/websocket.ts:9-27` | No cap on concurrent WebSocket connections; every broadcast iterates all of them. | Global connection cap; largely mitigated once SEC-1 and SEC-4 land. |
| RATE-10 | Medium | `tests/` | No test exercises any limiter's threshold or 429 body. | One integration test per limiter family. |
| RATE-4 | Low | `server/routes/middleware.ts:30-33` | `dependencyDeleteLimiter` sets no `message`, so its 429 is plain text and breaks the `{ error }` convention. `statsLimiter`, `firstRunLimiter` and `spaLimiter` have the same gap (RATE-5). | Add `message: { error: "..." }`. |
| RATE-9 | Low | `routes/otlp.ts:20-26`, `index.ts:35-42` | On loopback every agent and exporter shares one IP, so the OTLP and MCP budgets (120 a minute each) are machine-wide, not per agent. A conscious trade-off, but ten busy agents would hit it. | Key `/mcp` on `mcp-session-id` where present. |

Also: `GET /api/ingest/paths` has no dedicated limiter although its POST and DELETE siblings do (PII-5).

## Personal and sensitive data

Headline: transcript prompt and response content is never read, let alone stored, and OTLP identity attributes never reach SQLite in plaintext. There is no `/v1/logs` endpoint, so the OTLP exporter that carries prompt text is never accepted. The exposure is network reachability (covered under Security) and logging.

| ID | Sev | Location | Issue | Fix |
|---|---|---|---|---|
| PII-4 | Medium | `server/ingest/otlp/ingest.ts:283-295` | The one whole-object log call in the codebase: the entire OTLP resource-attribute map goes into a `logger.warn`. Claude Code and Codex exporters can put `user.email`, `user.account_uuid`, `organization.id` and `session.id` there. The branch is reachable by an unauthenticated POST with an oversized token sum, so it is attacker-triggerable. | Log an allow-list (key, model, token counts, `vibe_dash.project`). |
| PII-5 | Medium | `routes/ingest.ts:53-55`, `routes/worktrees.ts:19-21` | Unauthenticated endpoints return absolute paths containing the OS username and client or project directory names. | Fix the boundary first; then return basenames where the UI does not need more. |
| PII-6 | Medium | `server/ingest/transcripts/sync.ts:227` | On every file error the full transcript path is logged; it encodes the username, the working directory and the session id. | Log the basename at warn, the full path at debug. |
| PII-7 | Medium | `docs/ingestion.md:127-132` | The doc says the originating directory "is not currently stored anywhere". `transcript_files.path` stores the absolute transcript path, whose directory name is the URL-encoded working directory. It is not exposed by any route, but the privacy claim is inaccurate. | Amend the doc. |
| PII-11 | Low | `server/logger.ts:6-11` | pino has no `redact` list and defaults to `debug` outside production, so there is no safety net for future log calls. | Add a redact list for the OTLP identity keys. |
| PII-8 | Low | `.dockerignore`, `Dockerfile:11` | `.dockerignore` omits `*.bak`, so the 5 MB real database backup in the repo root is copied into the builder layer by `COPY . .`. It does not reach the runner stage. | Add `*.bak` and `*.db.bak`; move backups out of the tree (OPS-2). |
| PII-9 | Low | `index.html:7-10`, CSP in `server/index.ts:53-54` | Google Fonts is the only outbound call in a product whose README says "no cloud". It leaks IP and load timing and means the fallback font renders offline. | Self-host the woff2 files and drop both CSP allowances. |
| PII-10 | Low | `tests/fixtures/transcripts/basic.jsonl:1-3`, `docs/archive/completed-plans/2026-08-09-transcript-ingestion.md` | The real OS username appears in fixture paths. The fixtures are otherwise synthetic, and a repo-wide scan found no real email addresses, session ids or prompt text. | Substitute a neutral username. |
| PII-12 | Low | `.gitignore:31-32` versus `git ls-files` | `.mcp.json` is tracked although an ignore rule says it should not be. Current content is harmless; the risk is a local edit being staged silently. | `git rm --cached` it, or delete the ignore rule and own the file. |

The "what is persisted" inventory for transcripts and OTLP produced by this pass is accurate and worth lifting into `docs/ingestion.md` as it stands.

## Data layer and migrations

| ID | Sev | Location | Issue | Fix |
|---|---|---|---|---|
| DATA-1 | Critical | `server/db/schema.ts:53-59`, `migrator.ts:418-612` | `initDb()` runs migrations on every open by every process. Migrations 008, 010-013, 015, 017 and 018 drop tables or merge and delete agent rows, with no snapshot and no downgrade. `scripts/backup-db.mjs` is a correct tool (`VACUUM INTO`, integrity checks, rotation) and nothing calls it. A user who runs `vibe-dash status` on a newer build loses tags, comments and git-link history before the output prints. | Snapshot automatically before any migration on a destructive list; abort if the snapshot fails. |
| DATA-2 | High | `server/db/schema.ts:10-51` | `rebuildTasksIfFkStale()` runs after migrations on every open and copies a literal 16-column list. Any future `tasks` column is silently dropped on a legacy database, with its migration already recorded as applied. | Derive columns from `PRAGMA table_info`, or turn the rebuild into a numbered once-only migration. |
| DATA-3 | High | `server/db/schema.ts:18-47` | The same rebuild drops all five `tasks` indexes and recreates none. Tests assert the indexes only on a fresh database, which never takes this path. | Add the five `CREATE INDEX IF NOT EXISTS` statements to the rebuild. |
| DATA-5 | High | `cli/index.ts:59-60`, `server/mcp/stdio.ts:12-27`, `server/index.ts:91-106` | Three process types open the file read-write and can each run destructive migrations, concurrently. This is the shape of the known corruption incident. | CLI opens read-only and refuses to migrate; migration authority lives in the server, or behind a cross-process lock. |
| DATA-4 | Medium | `migrator.ts:851-889`, comment at `:825-830` | `_migrations` stores names only, and migration 022's own comment records that it was amended in place because it "has not shipped anywhere yet". The code cannot check that claim. (The package is not on npm today, which lowers this from High, but there is a Docker image and git clones.) | Store a checksum per migration and refuse to open on mismatch. |
| DATA-6 | Medium | `server/db/schema.ts:15-50` | The rebuild uses a raw `BEGIN ... COMMIT` string with no `ROLLBACK`, and restores `foreign_keys` in a `finally` where the pragma is a silent no-op if the transaction is still open. A failed rebuild returns a handle with enforcement off and a write lock held. | `db.transaction()`, then assert the pragma took. |
| DATA-7 | Medium | same | No `PRAGMA foreign_key_check` after a foreign-keys-off rebuild. Migration 020 handles this properly; the rebuild does not. | Run it and fail loudly. |
| DATA-8 | Medium | `src/components/dashboard/TodayCard.tsx:49`, `server/db/costs.ts:140,164`, `tasks.ts:217`, `agents.ts:321,336` | "Spend today, since midnight" means UTC midnight. In Australia the card reads `$0.00` until mid-morning and then jumps; in the US it resets mid-evening. Day buckets are UTC everywhere, so it is consistent, just mislabelled. | Relabel as UTC or compute local-day boundaries across all six sites plus client grouping. |
| DATA-9 | Medium | `server/ingest/transcripts/parse.ts:29`, `sync.ts:159` | Transcript rows store the transcript's own timestamp string unvalidated, while every "today" query compares `created_at` as a string. A non-`Z` offset form would land in the wrong day silently. UNVERIFIED what Claude Code writes today. | Normalise through `new Date(ts).toISOString()` and drop invalid dates. |
| DATA-10 | Medium | `server/mcp/server.ts:263`, `server/db/costs.ts:82-113` | Migration 020 rebuilt `cost_entries` so that `cost_usd` could be NULL ("unknown is not free"), but the `log_cost` tool schema still requires a number. An agent on an unpriced model can only say `0`, which the honesty signal then ignores. | `z.number().nullable()`. |
| DATA-11 | Medium | `migrator.ts:642-646` | Migration 019 adds columns without the `table_info` guard every sibling uses. A database that has the columns but not the record becomes unopenable by every entry point. | Apply the guard. |
| DATA-12 | Medium | `activity.ts`, `costs.ts`, `agents.ts`, `sync.ts` | No retention, cap or `VACUUM` anywhere. `activity_log`, `cost_entries`, `agent_sessions` and `transcript_files` grow without bound and space freed by table rebuilds is never returned. | Configurable `activity_log` window; document that cost rows are never pruned; `VACUUM` after rebuild migrations. |
| DATA-13 | Medium | `server/db/path.ts:73-76` | The default database lives inside the git working tree. `git clean -xdf` removes ignored files, so one routine command deletes the database, its WAL and every in-tree backup. | Default to `~/.vibe-dash/`, falling back to the in-tree path only when it already exists. |
| DATA-14 | Medium | `docs/self-hosting.md:275-278` | Recommends a bare `cp` of a live WAL-mode database and says WAL makes that safe. It does not: the repo's own `.db-backups` shows a 4.3 MB WAL beside a 5.0 MB main file. | Point to `npm run backup`. |
| DATA-15 | Medium | `schema.ts:54-58`, `migrator.ts:882-888` | No explicit `busy_timeout` (the driver default of 5 s applies) and migrations use deferred transactions, so two processes starting together can both read `_migrations`, and the loser crashes on the unique constraint. No corruption; an unexplained startup failure. | Explicit `busy_timeout`; `.immediate()` transactions for migrations. |
| DATA-16 | Low | `migrator.ts:64-80` | No CHECK constraints behind any status or enum column; enforcement is zod at the edge only and does not cover the CLI or direct SQL. A stray value makes a task invisible to every progress figure. | CHECK constraints in a rebuild migration, after scanning existing values. |
| DATA-17 | Low | `server/db/helpers.ts:16-28` | `JSON.parse` of `capabilities` with no guard; one malformed row takes down the whole agents endpoint. | try/catch with a `[]` fallback and a warning. |
| DATA-18 | Low | `server/db/milestones.ts:102-105` | `deleteMilestone` is exported, unreachable, and would fail on foreign keys if wired up. | Delete it, or give it child handling before PROD-3 uses it. |
| DATA-19 | Low | `migrator.ts:651-652`, `costs.ts:55-60` | `idx_cost_entries_source` has three distinct values and earns nothing; the observed-duplicate predicate is a correlated subquery repeated six times per dashboard query, with `agents.client_name` unindexed. | Drop the index; add `idx_agents_client_name`; hoist to a CTE. |

Verified: `vibe-dash.db.2026-07-07-predelete.bak` is not tracked by git; no `*.db` file is tracked.

## Server architecture and performance

| ID | Sev | Location | Issue | Fix |
|---|---|---|---|---|
| ARCH-1 | High | `schema.ts:53-65`, `path.ts:67-77`, `stdio.ts:27`, `cli/index.ts:57-60` | Nothing in code enforces the single-owner rule the project learnt the hard way: no lock file, no live-PID check, no warning when a second process opens the file. `resolveDbPath()` deliberately points every entry point at the same file. (Rated Critical by the pass; High here because WAL plus the default busy timeout makes same-host contention usually survivable, and the corruption history involved a Docker bind mount as well.) | Advisory lock file with PID liveness at `openDb()`; refuse or warn loudly. |
| ARCH-2 | High | `server/routes/costs.ts:26-35` versus `server/mcp/tools.ts:262-295` | MCP `log_cost` was fixed with `blankToNull()` because `""` ids pass validation, fail the foreign key and lose the row. REST `POST /api/costs` has the identical schema and no such guard. | Move `blankToNull` to `db/helpers.ts`; use it on both paths. |
| ARCH-3 | High | `server/routes/tasks.ts:78-87` | Bulk task update never calls `logActivity`. Moving twenty tasks to done leaves no audit trail, on a product whose pitch is trustworthy data. | Share the single-task logging with the bulk path. |
| ARCH-4 | High | `server/routes/handlers.ts:17-34` | `handleMutation` has a bare `catch` that returns 500 without logging and without `next(err)`. Every create route fails silently server-side, which hides ARCH-2. | `logger.error({ err })` in the catch. |
| ARCH-5 | High | `routes/blockers.ts`, `dependencies.ts`, `worktrees.ts`, `milestones.ts` versus `mcp/tools.ts:241-260` | REST blocker create and resolve write no activity row; the MCP equivalents do. Dependencies, worktrees and milestone create/update log nothing on either path. There is no shared service layer: each transport hand-rolls validation, logging and broadcast. | One service function per mutation, called by both transports. |
| ARCH-6 | Medium | `mcp/tools.ts:176-218` versus `routes/tasks.ts:110-140` | MCP `update_task` always logs; REST logs only on status or progress changes. Same operation, different audit trail. | Converge via ARCH-5. |
| ARCH-7 | Medium | `server/mcp/server.ts:139-147` | MCP `create_task` overrides the shared schema to make `priority` optional; REST rejects the same body with 400. | Make it optional with a default in the shared schema. |
| ARCH-8 | Medium | `server/mcp/tools.ts:163-174` | Auto-assignment is read-then-write across two `updateTask` calls with no conditional update. Two agents claiming the same task both succeed and the second silently overwrites the first. For a multi-agent task board this is the core coordination primitive. | `UPDATE ... WHERE assigned_agent_id IS NULL` and report the lost race to the caller. |
| ARCH-9 | Medium | `server/db/dependencies.ts:5-22` | Cycle detection catches only direct self-reference; A depends on B depends on A is accepted. | Bounded transitive walk before insert. |
| ARCH-10 | Medium | `shared/types.ts:313-341`, `src/state/wsReducer.ts` | Six declared WebSocket event types are never broadcast; seven that are broadcast (`milestone_achieved`, `worktree_*`, `cost_ingested`, `project_path_*`, `metrics_logged`) have no reducer case. "Real-time" holds for tasks, agents and blockers only; the rest waits for the 3-second poll. | Remove the dead types; wire or document the poll-only ones. |
| ARCH-11 | Medium | `cli/index.ts:57-60,111-150` | The CLI is a fourth direct writer, and `add-task` writes no activity row and cannot broadcast. | Log activity; longer term have the CLI call the HTTP API when a server is up. |
| PERF-1 | Medium | `server/db/projectContext.ts:20-22` | N+1 inside `get_project_context`, the tool whose purpose is one-call orientation: one `COUNT` per open milestone (48 open milestones in the live data). | One `GROUP BY milestone_id` query. |
| PERF-2 | Medium | schema-wide | Same as DATA-12: no retention on the tables the hot queries aggregate. | See DATA-12. |
| PROC-1 | Medium | `server/index.ts` | No SIGINT or SIGTERM handler: no `server.close()`, open MCP transports and `agent_sessions` rows are not closed, the database handle is not closed. Session statistics are wrong after every restart. | A shutdown routine that drains, cleans up transports and closes the database. |
| PROC-2 | Low | `server/index.ts` | No `unhandledRejection` or `uncaughtException` handler, so a crash leaves no structured log line. | Log through pino, then exit. |
| ARCH-13 | Low | `server/routes/agents.ts:77-79` | The public query parameter is still `sprint_id` although sprints became milestones project-wide. | Rename, with an alias. |
| DEBT-1 | Low | line counts | `migrator.ts` 889, `db/agents.ts` 441 (CRUD, sessions, cost identity and statistics in one file), `useApi.ts` 428, `sync.ts` 349, `mcp/tools.ts` 337. | Split `db/agents.ts` along its four seams; per-version migration files if 889 keeps growing. |

Confirmed and correctly documented: stdio tool calls cannot broadcast, because `broadcast()` returns early when no WebSocket server exists in that process. Type sharing has no drift: `server/types.ts` and `src/types.ts` are one-line re-exports of `shared/types.ts`. (The line in `CLAUDE.md` describing "parallel `types.ts` files" is therefore stale.)

## Frontend architecture

**Refocus status.** Not started in `src/` beyond the dead-code deletion in PR #125, as `docs/views.md` itself admits. `AgentComparisonView` and `WorktreeView` are gone. `FleetView`, `PresetSwitcher` and `AgentDashboard` are fully wired. The default is hardcoded at `src/store.tsx:47` (`activeView: "fleet"`) with no persistence, `ViewToggle.tsx:4-8` still lists three views, and `CommandPalette.tsx:24-32` and `state/types.ts:15-17` still encode the three-view, two-preset model.

| ID | Sev | Location | Issue | Fix |
|---|---|---|---|---|
| FE-1 | High | `board/KanbanColumn.tsx:61-83`, `topbar/TopBar.tsx:55-58`, `state/wsReducer.ts:8-24` | Creating a task or project inserts it twice. The component dispatches a synthetic `WS_EVENT` from the REST response, the server also broadcasts the same event back to the same tab, and the reducer appends without an id check (unlike `agent_registered`, which dedupes). The duplicate card lasts until the next poll. (Rated Critical by the pass; High here because it self-heals in about three seconds.) | Make every `*_created` case idempotent by id. |
| FE-2 | High | `src/main.tsx:6-12` | No error boundary anywhere. Four components carry comments saying they guard nulls "because there's no ErrorBoundary". Any unanticipated render exception blanks the app. | Top-level boundary with a reload affordance, modelled on the existing load-error banner. |
| FE-3 | High | `src/components/AgentDashboard.tsx:38-68` | The effect depends on the `agents` array, which is a fresh reference every 3-second poll, and issues three requests per agent with no cancellation guard. With the 63 agents in the live data that is about 190 requests every three seconds while the Agents preset is open, which would also trip the global limiter. | Key on a stable id string, add the `cancelled` guard, fetch only the selected agent. |
| FE-4 | High | `TaskBoard.tsx:70-78`, `KanbanColumn.tsx:61-83`, `TaskEditDrawer.tsx:63-98`, `AddProjectControl.tsx:18-31` | Mutation failures are swallowed (`catch {}`) in drag and drop, inline add, drawer save and add project. The user believes the action worked and the state quietly reverts on the next poll. Only the keyboard-move path shows an error. | Reuse the keyboard-move error pattern or the load-error banner. |
| FE-5 | High | `src/hooks/useApi.ts` | No `AbortSignal` anywhere in the data layer, so superseded responses land after newer ones. | Thread an `AbortController` per effect. |
| FE-6 | Medium | `src/store.tsx:159-172` | State is correctly split into four contexts, but the `useAppState()` shim merges them back and five components use it. `AgentFeed`, visible on every view, re-renders on every search keystroke and every poll tick. | Move the five consumers to the domain hooks. |
| FE-7 | Medium | `KanbanColumn.tsx:168-183`, `ProjectList.tsx:71-79`, `AgentFeed.tsx:119-141` | No virtualisation; `ProjectCard` and `AgentRow` are not memoised. Full lists reconcile every three seconds. | Memoise first; virtualise the column body if task counts grow. |
| FE-8 | Medium | `src/hooks/useWebSocket.ts:33-37` | Reconnect never triggers a refetch; recovery of missed events relies on the unrelated poll happening to run. The reconnect delay is a flat 2 s with no backoff or jitter (also INC-8). | Refetch on `onopen`; jittered exponential backoff. |
| FE-9 | Medium | `src/state/wsReducer.ts` | 11 of 27 event types handled; the rest fall through silently. Client half of ARCH-10. | As ARCH-10. |
| FE-10 | Medium | `tests/state/` | No tests for `wsReducer`, `useWebSocket` or `usePolling`, which is exactly the code behind FE-1, FE-8 and FE-9. | Reducer tests for duplicate ids, ordering and unhandled types. |
| FE-11 | Medium | `TaskBoard.tsx:193,210,226`, `TopBar.tsx:374` | Four literal `#fff` values bypass `--text-on-accent`. | Use the token. |
| FE-12 | Low | line counts | `AgentDashboard.tsx` 476 (five components in one file), `TopBar.tsx` 420, `DashboardView.tsx` 410, `App.tsx` 389, `TaskCard.tsx` 361. | Split `AgentDashboard` the way `TaskEditDrawer` was split; or retire it with the refocus. |
| FE-13 | Low | `board/KanbanColumn.tsx:10-29` | Fifteen props, including the whole `api` object, although `useApi()` is a stable memo. | Call `useApi()` in the leaf. |
| FE-14 | Low | `OnboardingWizard.tsx:121-126`, `TopBar.tsx:131,155` | Timers without cleanup. Harmless, inconsistent. | `clearTimeout` in cleanup. |

Architectural note: the client runs a full 3-second poll and a WebSocket at once, uncoordinated. The poll masks FE-1, FE-8 and FE-9, which is why they have survived. Decide which is the source of truth; the usual shape is WebSocket for deltas plus a refetch on connect and on window focus, with a slow safety poll.

`tsc --noEmit` on the client and `eslint src` are both clean.

## UI design and usability (live review)

Caveat: the instance reviewed is the 2026-08-01 image (LIVE-1), so the cost-incomplete indicators and the September contrast fixes were not visible. Structure and interaction findings were cross-checked against current source where they matter.

| ID | Sev | Observation | Fix |
|---|---|---|---|
| LIVE-1 | Critical | The container on `:3001` runs an image created 2026-08-01T02:56Z. Transcript ingestion merged 2026-08-10 (#175). `/api/ingest/status` and `/api/ingest/paths` return 404, `spend_today` is 0, and none of the OTLP, series-cap, cost-completeness or accessibility work since is deployed. The only real user has never run the product's wedge in daily use. | `docker compose up -d --build` after LIVE-2; then LIVE-3 so it cannot recur unnoticed. |
| LIVE-2 | High | `docker-compose.yml` mounts only `vibe-dash-data:/data`. Inside the container `~/.claude/projects` does not exist, so transcript ingestion finds nothing and reports nothing. `docs/self-hosting.md:73` lists `VIBE_DASH_CLAUDE_HOME` but never says a mount is required. Docker users get a silently empty cost view. | Read-only bind mount of the host transcripts directory plus `VIBE_DASH_CLAUDE_HOME` in compose; document it; show an "ingestion found no transcript directory" state in the UI. |
| LIVE-3 | High | `/api/health` returns `{ ok: true }` and the UI shows no version, commit or build date, so a stale deployment is invisible. | Version and build timestamp in health and a footer; optionally warn when the database carries newer migrations than the build expects (the drift guard already knows). |
| UX-1 | High | The app opens on Fleet, a KPI dashboard (48 open milestones, 8 overdue tasks, milestone progress bars). The owner's stated daily use is the task board. Two clicks to reach the thing that matters, every load. | Default to Board and persist the last view, ahead of the full refocus. |
| UX-2 | High | The project sidebar lists 51 projects, 45 of them `[E2E] Board-*` test debris plus `smoke-proj`. Finished projects (44/44, 16/16, 9/9 done) sit there forever. No archive, hide, sort, filter or collapse. The top-bar counts (51 projects, 113 tasks) are inflated by the same junk. | Project archive (PROD-2); hide archived and fully completed projects by default. |
| UX-3 | High | The In Progress column shows 12 tasks while Active Agents shows 0. Several are E2E tasks from July. Stale in-progress work looks identical to live work, and the Feed shows unrelated commit messages from other repositories logged against `[E2E] Status Task ...` and a July command-palette task, because an external commit hook attaches activity to whatever is in progress. Misattributed activity is a direct hit on "trustworthy data". | Show age and last-touched on in-progress cards; flag "in progress, no live agent for N days"; offer one-click return to planned. The hook lives outside this repo, but the product should be robust to it. |
| UX-4 | Medium | The agent rail reads "No active agents, Offline (63)". The 63 identities include `claude-code`, `Claude`, `Claude Agent`, `claude-opus-4-6`, `Claude (Opus 4.7)`, `Claude Sonnet 4.6`, `claude-sonnet-4-6` and one-off dispatcher names. Identity fragments per model and per whim, so per-agent statistics are meaningless. | Identity should come from the MCP client name plus session, not the self-declared name; collapse or expire offline agents in the rail. Check whether `cleanupStaleAgents` is running once LIVE-1 is fixed. |
| UX-5 | Medium | Conflicting scope signals on Board: the context chip says "E-Rate Prospector" while the board header says "All Projects" and shows tasks from every project. The Done column reads 0 while the sidebar says 482/537 done for the same project. UNVERIFIED why Done is empty (likely a recency filter), but nothing on screen explains it. | One scope indicator; label the Done column's window ("last 7 days") or show a count with "show all". |
| UX-6 | Medium | The task drawer is an edit form only: title, description, status, priority, milestone, agent, due date, story points, start date, progress. No project name, no activity timeline, no blockers, no dependencies, no cost, no visible close button. The refocus called for exactly those to fold into the drawer. Story points and start date are ceremony for a board that agents maintain. | Read-first drawer: context and timeline on top, edit fields collapsed. |
| UX-7 | Medium | The alert banner pins one blocker, truncated to a single line with an ellipsis, to the bottom of every view. It cannot be expanded, clicked through or dismissed, and the blocker shown is weeks old. (Also A11Y-11.) | Make it a button that opens the blocker; allow snooze; show age. |
| UX-8 | Low | Shortcut hints render as Mac glyphs on Windows. | Detect platform and print Ctrl+K. |
| UX-9 | Low | At 800 px the dashboard sits in a nested scroll container with its own horizontal scrollbar, and native scrollbars are unthemed (bright white on the dark theme). | `color-scheme: dark` on the root; let the dashboard grid wrap instead of scrolling sideways. |
| UX-10 | Low | At 375 px the shell adapts well (Projects and Agents become drawers), but Feed rows keep their desktop columns: the message wraps into a column about 100 px wide and the task reference is clipped off screen. | Stack Feed rows below about 600 px. |
| UX-11 | Medium | The Feed's newest entry is 2026-09-09 and the one before is 2026-07-30, although this repository alone merged ten pull requests in that window. Activity depends entirely on agents choosing to call `log_activity`, which is the self-reporting problem the wedge exists to solve. Cost is now observed; activity is not. | Derive session-level activity from the transcripts already being read (session start and end, project, duration, turn counts; no content). It is the natural second feature under the 2026-08-09 positioning. |

## Accessibility (WCAG 2.1 AA)

The M8 accessibility pass holds up: task cards, project rows and agent cards are real keyboard-operable buttons, drag and drop has a working keyboard alternative with a live region, dialogs use `focus-trap-react`, status is never colour-only, `:focus-visible` is global and never suppressed, and reduced motion is honoured. The findings are in components added or changed since.

| ID | Sev | WCAG | Location | Issue | Fix |
|---|---|---|---|---|---|
| A11Y-2 | High | 4.1.2, 2.1.1 | `src/components/CommandPalette.tsx:159-323` | The palette is `role="dialog" aria-modal` with no focus trap; Tab leaves it while it stays open. The input has no combobox role, `aria-controls` or `aria-activedescendant`, so arrowing through results announces nothing. | Wrap in the focus trap already used elsewhere; add the combobox wiring. |
| A11Y-1 | High | 1.4.3 | `TopBar.tsx:187`, `TaskBoard.tsx:174`, `board/MilestoneFilter.tsx:24` | In the light theme, `--text-secondary` (#656d76) on `--bg-tertiary` (#e8ecf0) is 4.42:1 on three select controls. `docs/a11y-baseline.md:43-45` already names this pairing as a real failure. | Use `--text-primary` or `--text-muted` there. |
| A11Y-3 | High | 2.1.1 | `TopBar.tsx:342-413`, `App.tsx:86-91` | The Appearance popover closes only on outside mouse-down. Escape closes everything else but not this, so a keyboard user cannot dismiss it. | Escape handler that returns focus to the trigger. |
| A11Y-4 | High | 1.1.1 | `dashboard/CostCards.tsx:87-105`, `dashboard/MilestoneCards.tsx:76-99` | Bar values live only in `title` attributes on non-focusable divs. The cost chart never shows a figure in text. This is the defect M8 fixed in the heatmap, reintroduced. | `aria-label` per bar or a visually hidden table. |
| A11Y-5 | High | 2.4.1 | whole app | No skip link; about a dozen tab stops before content on every load. | Skip to `<main>`. |
| A11Y-6 | High | 4.1.3 | `AgentFeed.tsx`, `ActivityStreamView.tsx` | The only live region in the client is the keyboard-grab bar. Agents going offline and new activity are silent to screen-reader users. | One polite region with coalesced, debounced summaries. |
| A11Y-7 | Medium | 4.1.3 | `TaskBoard.tsx:93-100` | A successful keyboard move removes the live region at once, so the user hears the intent and never the confirmation. | Announce "Moved to ..." before clearing. |
| A11Y-8 | Medium | 1.4.10 | `TaskBoard.tsx:238-246` | The board is a fixed three-column grid with no breakpoint; at 320 px each column is about 100 px. | Stack below about 650 px. |
| A11Y-9 | Medium | 1.3.1, 2.4.6 | whole app | No `<h1>`; headings start at `<h2>`. | Visually hidden h1 or promote the view title. |
| A11Y-10 | Medium | 2.4.2 | `index.html:6` | The title never changes with the view. | Set `document.title` on view change. |
| A11Y-11 | Medium | 1.3.1 | `AlertBanner.tsx:34-59` | Truncated reason and "+N more" with no way for sighted users to read the rest. | As UX-7. |
| A11Y-12 | Low | 4.1.2 | `fleet/PresetSwitcher.tsx:14-69` | `tablist` roles without arrow-key behaviour or a `tabpanel`. | Plain button group; disappears with the refocus. |
| A11Y-13 | Low | 1.4.6 claim | `docs/a11y-baseline.md:40-42` | The 7:1 claim for `--text-muted` is not met on `--bg-tertiary` (6.25:1 dark, 6.42:1 light). Passes AA. | Adjust the claim or the token. |

## Product fit, documentation and adoption

| ID | Sev | Location | Issue | Fix |
|---|---|---|---|---|
| DOC-1 | Critical | `docs/MCP-SETUP.md:51`, `docs/integrations/claude-code.md:18-56` | The docs head stdio "Option A: Stdio (recommended for local use)" and the only tested integration guide lists stdio first for project and global config, offering HTTP third as a "remote, team" option. No file in the repository mentions that concurrent stdio processes have corrupted the database. The only steer away from stdio is in a team-deployment troubleshooting section. The repository's own `.mcp.json` uses HTTP. Verified in source. | Lead with HTTP everywhere; state the corruption risk in the transport table; describe stdio as the fallback for when no server runs, one session at a time. |
| PROD-2 | Critical | `server/routes/projects.ts:9-22`, `server/mcp/server.ts` | No way to delete or archive a project through REST, MCP or UI. See UX-2 and CI-2 for the consequences already visible. | Soft archive (in keeping with "cost rows are never deleted") across all three surfaces. |
| PROD-1 | High | `README.md` | No screenshot or GIF of a product whose value is visual. `docs/plans/R13/R13.2` planned a hero screenshot and it never shipped. | Board screenshot above the fold, plus one of the cost view showing the "observed" provenance. |
| PROD-3 | High | `server/mcp/server.ts:128-137` | Milestones can only be completed: no reopen, cancel or delete over MCP or REST. The live data shows 48 open milestones, many of them cancelled scopes the owner could not close. | A status-setting tool and endpoint mirroring `update_task`, with `cancelled` as a state. |
| PROD-4 | High | `server/routes/worktrees.ts`, `task_worktrees` | Live REST surface and a table for a feature with no MCP tool, no UI and a comment referencing a `create_worktree` tool that was never built. The 2026-08-09 decision explicitly rejects worktree launching. | Remove the route, types and events, and drop the table behind a snapshot (DATA-1). |
| OSS-1 | High | repo root | No SECURITY.md or reporting channel, for an unauthenticated self-hosted tool with the findings above. | Minimal SECURITY.md with a private contact and the loopback-only threat model stated. |
| PROD-5 | Medium | `server/routes/` | No cost budget or alert and no export of tasks or costs. For a tool whose wedge is cost data, a daily threshold and a CSV are the first things an adopter asks for, and no decision doc records cutting them. | Build them, or write the decision. |
| PROD-6 | Medium | `server/mcp/tools.ts:79-119` | No pre-insert existence checks, so a mistyped `project_id` yields a raw `FOREIGN KEY constraint failed` rather than "unknown project; call list_projects". UNVERIFIED exact wording. | Validate and return `isError` with the corrective next step. |
| OSS-2 | Medium | git | `package.json` says 1.0.0 but there are no tags, releases or changelog. An adopter cannot pin or see what changed, and cannot tell whether a migration is destructive before upgrading. | First tagged release via the preparing-releases workflow. |
| DOC-2 | Medium | `docs/self-hosting.md:263-289` | The backup section never mentions `npm run backup`, the one correct tool. See DATA-14. | Make it the primary recommendation. |
| DOC-6 | Medium | `docs/self-hosting.md:101,115,128` | The pm2 and systemd examples run `npm run serve`; `package.json` has no `serve` script. Both fail as written. Verified. | Add the script (`tsx server/index.ts`) or fix the docs. |
| OSS-4 | Medium | `.github/workflows/ci.yml` | CI is Ubuntu only although the sole real user is on Windows and the code has win32-specific path logic and a native module. | Add a `windows-latest` unit-test leg. |
| PROD-8 | Low | `package.json` | Shaped for npm (`bin`, `files`, `prepublishOnly`) but never published; `npx vibe-dash` does not work, and the `bin` points at the stdio entry, the transport the docs should stop recommending. | Publish with a `bin` that starts the server, or drop the publish fields. |
| PROD-7 | Low | `README.md:77-82`, `docs/views.md:34-38` | The README describes Fleet, Board and Feed with no hint that Fleet is slated for removal. | Resolved by doing the refocus. |
| DOC-3 | Low | `docs/plans/R13/R13.2-docs-and-repositioning.md` | The "largely shipped" banner sits above a body that lists never-built deliverables and cut features. | Archive it. |
| DOC-4 | Low | `docs/adr/` versus `docs/decisions/` | One decision record lives alone in `docs/adr/`. | Move it. |
| DOC-5 | Low | `README.md:140-148` | The Development section omits `backup`, `lint`, `test:e2e` and `typecheck`. | List them. |
| DOC-7 | Low | `CLAUDE.md` | "Types: shared between server and client via parallel `types.ts` files" is stale; both are re-exports of `shared/types.ts`. | Correct the line. |
| OSS-5 | Low | `.github/dependabot.yml` | npm is deliberately excluded (reasoned in a comment), so drift is watched by nobody: eslint 9 to 10, typescript 6 to 7, better-sqlite3 12 to 13, eslint-plugin-unicorn 60 to 75. | A monthly grouped npm entry, or a calendar reminder. |
| OSS-6 | Low | `README.md:164-171` | The Roadmap section points at an archived April review. | Three lines of current direction. |

Target-user fit in one paragraph: the wedge (observed cost beside a board the agents maintain) is real, differentiated and well executed in the ingestion code. What undermines it for a stranger is the first fifteen minutes: no picture, clone-only install, a transport recommendation that endangers their data, an opening screen that is not the board, no way to clean up a mistake, and under Docker no cost data at all. What undermines it for the existing user is that activity is still self-reported (UX-11), agent identity fragments (UX-4), and stale or misattributed activity sits beside the trustworthy cost figures (UX-3).

## Tests, CI, dependencies and operations

| ID | Sev | Location | Issue | Fix |
|---|---|---|---|---|
| CI-1 | Critical | `playwright.config.ts:39-52` | The local `webServer` block uses `reuseExistingServer: true` with no `env`, so Playwright attaches to whatever is on the port and creates `[E2E] ...` projects through the live API. No `VIBE_DASH_DB` is ever set for e2e. A captured snapshot in `playwright-report/` shows `smoke-proj` in the sidebar during a run, which proves a real database was hit. Root cause of the 45 junk projects. | Temp `VIBE_DASH_DB` on both blocks; never reuse a server. |
| CI-2 | Critical | `e2e/`, `server/routes/projects.ts` | No `globalTeardown`, no `afterAll` cleanup, and no delete API to clean up with. Pollution is permanent short of raw SQL. | PROD-2 plus a teardown. |
| CI-3 | High | `server/ingest/transcripts/discover.ts:17`, `server/index.ts:187-198` | Neither Playwright nor CI sets `VIBE_DASH_CLAUDE_HOME`, so any local e2e or dev run ingests the maintainer's real transcript history into whichever database is active. | Point it at an empty temp directory in test configs. |
| CI-5 | High | `package.json:93,110` on `main` | `vitest ^5.0.0` with `@vitest/coverage-v8 ^4.1.10`: the coverage provider is a major behind the runner that CI's coverage step uses. The concurrent branch `fix/vitest-coverage-v8-peer-dep` exists to fix exactly this. | Merge that branch. |
| CI-4 | Medium | `playwright.config.ts:39-44` | CI avoids the real-database problem only because runners are ephemeral, not by design. | Same fix as CI-1. |
| CI-6 | Medium | `coverage/lcov.info` (2026-08-09) | Line coverage is 54.6 percent, and zero or near zero on the riskiest files: `server/index.ts`, `server/websocket.ts`, `server/mcp/stdio.ts`, `src/App.tsx`, `useWebSocket.ts`, `usePolling.ts`, `CommandPalette.tsx`, `ActivityStreamView.tsx`. Several findings above live in exactly these files. | Supertest-style tests for the index middleware chain (they would pin the SEC fixes); reducer and hook tests (FE-10). |
| CI-7 | Medium | `tests/r1..r5-features.test.ts`, `tests/mcp-2c.test.ts` | Files named after release rounds and plan steps; `mcp-2c` actually tests migration 016. | Rename by subject. |
| CI-8 | Medium | `cli/index.ts` | 241 lines of argument parsing and database-mutating commands with no tests. | Test dispatch and `add-task`. |
| DEP-3 | Medium | `package.json` dependencies, `Dockerfile` CMD | `tsx` is a production dependency solely because the image runs TypeScript source, although `build:server` already produces `dist/server`. | Run `node dist/server/index.js` in the image; move `tsx` to dev. |
| OPS-2 | Medium | repo root, `.db-backups/` | 21 MB of real database backups inside the working tree, protected only by `.gitignore`, and all removable by one `git clean -xdf` (DATA-13). | Move to `~/.vibe-dash-backups`, the backup script's own default. |
| OPS-3 | Medium | `Dockerfile` | HEALTHCHECK exists only in compose, and it calls `/api/projects` rather than `/api/health`. | Add it to the image; use the health route. |
| CI-9 | Low | `ci.yml` matrix, `engines` | Node 20 reached end of life in April 2026 and is still a required leg and the `engines` floor. | Matrix 22 and 24; `engines >=22`. |
| CI-10 | Low | `ci.yml` | The Docker image is never built in CI. | A `docker build` job; optionally boot it and hit health. |
| CI-11 | Low | `ci.yml:51-52` | The comment justifying the audit gate cites an old advisory; the live one is js-yaml. | Update the comment. |
| CI-12 | Low | repo | No pre-commit hooks in the repository; lint and tests run only in CI. The maintainer's global hooks cover their own machine, not contributors. | Optional `lint-staged`. |
| CI-13 | Low | `tsconfig.client.json`, `tsconfig.server.json` | `ChartCards.tsx` and `tests/metrics.test.ts` are excluded from typecheck. | Fix and re-include. |
| CI-14 | Low | `tests/spend-today-unpriced.test.ts:16-27` | Builds fixtures from the live clock. Not flaky today; will need a fixed clock if DATA-8 moves "today" to local time. | `vi.setSystemTime`. |
| DEP-4 | Low | `src/hooks/useFocusTrap.ts` | 33 lines of hand-rolled focus trap, never imported; the three dialogs use `focus-trap-react`. | Delete. |
| OPS-4 | Low | `docker-entrypoint.sh:7` | Unconditional `chown -R` on every start. | Check ownership first. |
| OPS-5 | Low | git | Unmerged remote branches from August (`claude/relaxed-rhodes-c8f466`, `feat/transcript-ingestion`, `test-run-deconfliction`) and two docs branches that #197 appears to supersede; `docs/claude-md-lazy-loading` is one commit ahead of its remote. | Run the worktree-cleanup skill. |
| OPS-6 | n/a | GitHub | Required status checks on `main` were not inspected. UNVERIFIED. | Confirm `test` and `e2e` are required. |

Test isolation is otherwise good: no unit test touches the real `~/.claude`, and each test gets a fresh in-memory database.

## Hand-rolled code versus OSS incumbents

The codebase already complies with the prefer-mature-OSS policy where it matters: zod for validation, pino for logging, express-rate-limit, `ws`, `focus-trap-react`, helmet. No hand-rolled retry, auth, queue, cache, debounce, markdown or id generation exists.

| ID | Verdict | Subject | Reason |
|---|---|---|---|
| INC-8 | Migrate (small) | `useWebSocket.ts` flat 2 s reconnect | The only real gap: no backoff or jitter. Add it by hand or adopt `reconnecting-websocket`. Pairs with FE-8. |
| INC-10 | Watch | Native HTML5 drag and drop | Keyboard alternative already exists; revisit with `@dnd-kit` only if touch support becomes a goal. |
| INC-2 | Keep, extend | Migration runner (about 50 lines of logic) | Transactional, tested, and carries a drift guard that umzug would not provide. Add checksums (DATA-4) rather than migrate. |
| INC-3 | Keep | Static pricing table | Deliberate no-network design with NULL-not-zero semantics and a review date. Consider vendoring LiteLLM's JSON as a build-time cross-check rather than a source. |
| INC-4 | Keep | OTLP JSON parsing | It is JSON rather than protobuf, and the file encodes domain safety rules a generic package would not. |
| INC-1, INC-5, INC-7, INC-9 | Keep | CLI argument parsing, transcript directory walk, `where.ts`, command palette and sparkline | Small, tested, single-purpose; a dependency would add surface without removing a bug class. |

## What is done well

- Cost honesty is designed in: NULL means unknown and never zero, unattributed stays unattributed, overstatement is preferred to understatement, and the pricing table carries a review date.
- Ingestion idempotency is enforced by a partial unique index plus `INSERT OR IGNORE`, not by application logic; the transcript cursor refuses to advance past a partial line and handles rotation and truncation.
- The transcript parser is a field-by-field allow-list, and OTLP identity attributes are hashed at the boundary, so privacy follows from structure rather than from remembering to strip fields.
- Per-migration transactions are correct, migration 020 is a model SQLite table rebuild, and the schema-too-new guard fails with an actionable message at every entry point.
- SQL is uniformly parameterised; the REST boundary checks `typeof` rather than truthiness; zod schemas are the single source for REST and MCP.
- The client has no HTML-injection surface, validates everything it reads from `localStorage`, and ships three runtime dependencies.
- Docker hardening is careful and explained: loopback publish, a named volume with the WAL reasoning written down, privilege drop via `su-exec`, `--ignore-scripts` with an allow-list check that fails CI on drift, and actions pinned to commit SHAs with a Dependabot cooldown.
- The accessibility baseline from M8 is real and mostly intact.
- Scope cuts are executed as migrations and recorded as decisions rather than left to rot, the worktree leftover being the one lapse.

## Findings raised and rejected

- "Eight leftover tables (`users`, `commits`, `tags`, `task_comments` and others) are still created on every install." Wrong: migrations 015, 017 and 018 drop them. Verified with a grep of `DROP TABLE`.
- "Task descriptions are HTML-escaped on input and show `&amp;` in the drawer." The literal `&amp;` was seen in one live task, but no escaping code exists in the repository or its history; the agent that wrote the task typed it. Not a product bug.
- "The package is published to npm, so amending a migration in place is dangerous." The registry returns 404 for `vibe-dash`. The checksum recommendation stands (DATA-4) at lower severity.
- Memory and earlier guidance said the server must run natively because a Docker bind mount corrupts SQLite on this host. Current state: the compose file uses a named volume, which avoids the bind-mount problem, and that container is what serves `:3001` today. The guidance is superseded; the single-owner rule behind it is not.

## Counts

145 severity-rated findings: 6 Critical, 35 High, 62 Medium, 42 Low. A further 7 rows carry a verdict instead of a severity (the six OSS-incumbent rows and the unverified branch-protection check).

Each finding id is sized to become one tracked task. No vibe-dash tasks were created from this audit.
