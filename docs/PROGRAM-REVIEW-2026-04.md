# Vibe Dash — Program Review, April 2026

**Status**: Active guiding document. This supersedes earlier roadmap notes
and is the primary reference for R11+ planning until the next program review.

## Context

A market-positioning review: current state, 2026 AI-coding observability /
orchestration landscape, gaps Vibe Dash can fill, existing advantages, and
the next bets.

### Strategic direction (confirmed)

- **Primary intent**: *"a place to go to know what the status is on all of
  my projects."* Multi-project status overview is the core use case —
  everything else serves it.
- **Strategic bet**: **PM layer for AI agents**, not observability for
  agents. Vibe Dash owns project state; it is not competing with Braintrust
  / LangSmith / Arize on LLM traces.
- **Distribution model**: **Open-source first**, no SaaS aspiration. Any
  future hosted mode ships as an open-source self-host option, not a
  commercial product.
- **Platform stance**: Must be **usable across AI platforms** (Claude Code,
  Cursor, Codex, Copilot Workspace, Aider, future tools). Vibe Dash is not
  a Claude-only companion.
- **Design stance**: **Intelligence-first, information-dense, always
  useful.** Polish is optional; data density and utility are not.
- **Scope discipline**: When adding R11+ features, also run a **deprecation
  pass** on the existing feature set. Not everything currently shipped
  earns its keep.

---

## 1. What Vibe Dash Is Today

From `README.md` and `docs/superpowers/specs/2026-03-28-vibe-dash-design.md`:

> Local-first, real-time dashboard for monitoring AI-driven development.
> Gives humans at-a-glance visibility into project status, active work, and
> blockers — and gives AI agents a structured way to report progress via MCP.

**Through R10:**

- 68 MCP tools in [server/mcp/tools.ts](../server/mcp/tools.ts).
- Dashboard views in [src/components/](../src/components): Dashboard,
  Executive, AgentDashboard, TaskBoard, Timeline, Orchestration, Worktree,
  ActivityStream, AgentFeed, WebhookSettings.
- SQLite data model with 24+ tables: projects, tasks, milestones, agents,
  activity, costs, completion_metrics, reviews, file_locks, worktrees,
  webhooks, alert_rules, templates, saved_filters, milestone_daily_stats,
  sessions, and more.
- Shipped milestones: R9a orchestration/visibility, R9b access control
  (auth + WebSocket auth + migrations), R10 plugin/extension system.

---

## 2. The 2026 Market — Adjacent Categories

Three neighbors. None do what Vibe Dash does.

**2a. LLM / agent observability** — Braintrust, LangSmith, Arize, Langfuse
(acquired by ClickHouse, Q1 2026), Helicone, Galileo, Datadog LLM.
Trace-layer, cloud-hosted, eval-focused. They know the LLM call, not the
project.

**2b. Claude Code hook / session viewers** — `disler/claude-code-hooks-multi-agent-observability`,
`simple10/agents-observe`, `nexus-labs-automation/agent-observability`,
Marc Nuri's AI Coding Agent Dashboard. Ephemeral event streams; no durable
project state.

**2c. Multi-agent orchestrators** — `jayminwest/overstory`,
`ComposioHQ/agent-orchestrator`, `wshobson/agents`, Claude Code Agent
Teams. Runtime coordination; no PM layer.

**2d. Vibe-coding PM / Kanban** — Vibe Kanban et al. Proprietary SaaS,
kanban-only, thin data model.

---

## 3. Where Vibe Dash Wins

1. **The PM-layer gap — Vibe Dash's defensible center.** Trace tools know
   the LLM call; orchestrators know the process tree; nobody owns project
   state (milestones, blockers, due dates, acceptance, cross-project
   rollup). Vibe Dash already does. **Double down on this.**
2. **Local-first + open-source.** No data leaves the machine; no hosted
   dependency; inspectable by anyone. Every serious 2a/2d competitor is
   cloud SaaS.
3. **MCP-native on both sides.** Agents write, humans read, same state.
   Competitors use MCP as a read-only connector to a hosted backend.
4. **Breadth of data model.** Cost, reviews, file locks, worktrees,
   completion metrics, daily snapshots — one place, one schema.
5. **Cost tracking at the task/milestone layer.** Gateways track per
   request; Vibe Dash can answer *"R10 milestone cost $47; Agent-A is
   2.3× cheaper per completed task than Agent-B."* This is worth deeper
   investment in R11.

---

## 4. Recommended Bets — R11+

Ordered by leverage. Implemented as milestones R11, R12, R13 (see `§5`).

### Tier A — Own the PM-for-AI category  →  R11

1. **Cross-project / fleet view.** Primary-intent feature. A meta-dashboard
   over all local projects: health, active agents, burn rate, blockers
   rolled up. *The headline.*
2. **Cost intelligence v2.** Per-task ROI (cost vs lines/tests/completion),
   cost-per-completed-milestone, model/agent price-performance scorecards,
   budget alerts per project/milestone, cross-project cost leaderboards,
   anomaly detection (*"this task is 4× the median for its type"*). Goal:
   answer *"am I spending my money well?"* at a glance.
3. **Cross-platform agent ingestion.** Drop-in integrations / hook configs
   for Claude Code, Cursor, Codex, Copilot Workspace, Aider, plus a
   generic webhook shape. Auto-populate `activity` and `costs` without
   requiring agents to call MCP tools. This is the moat against
   Anthropic's Agent Teams — Vibe Dash becomes the substrate that
   persists across whichever AI tool the user runs today or tomorrow.
4. **Deprecation pass.** Audit the 68 MCP tools, 24 tables, and dashboard
   views. Kill what doesn't earn its keep. Every retained feature must
   defend itself against *"does this directly serve the multi-project
   status view?"*

### Tier B — Intelligence + density  →  R12

5. **AI-summarized digests + natural-language query over local state.**
   *"What changed on project X this week?"* / *"Where am I overspending?"*
   Run a local or user-keyed LLM over SQLite. Competitors can't do this —
   they don't own the structured state.
6. **Git host sync (GitHub/GitLab).** Two-way issue ↔ task sync; PR
   status on tasks. Removes the *"my team lives in GitHub"* objection
   without making Vibe Dash a GitHub skin.
7. **Information-density polish pass.** Not prettier — denser. Sparklines
   in list rows, inline cost/health badges, keyboard-driven navigation,
   a real command palette. Defer visual redesign.

### Tier C — Reach without SaaS  →  R13

8. **Optional self-hostable team mode.** Ships as an open-source server
   config. Uses R9b access control. Release valve for small teams who want
   shared Vibe Dash without each dev self-hosting.
9. **Docs + hero examples + homepage reposition.** *"Hook up Claude Code
   in 60 seconds"* / *"Cursor in 60 seconds"*. Reposition homepage to
   lead with *"the open-source project layer for AI-driven development"*.

### Explicitly de-prioritized

- **OpenTelemetry / GenAI semconv export** — enterprise-shaped; not the
  direction.
- **Slack/Discord/email/desktop notifications** — webhooks are enough.

---

## 5. Milestones & Tasks

These are created in the Vibe Dash database via MCP. Detailed Sonnet-ready
implementation plans live under [`docs/plans/R11/`](plans/R11),
[`docs/plans/R12/`](plans/R12), [`docs/plans/R13/`](plans/R13).

| Milestone | Theme |
|---|---|
| **R11 — Own the PM category** | Multi-project view, cost v2, cross-platform ingestion, deprecation |
| **R12 — Intelligence + Density** | NL query/digests, Git host sync, density pass |
| **R13 — Reach** | Self-hostable team mode, docs + hero examples |

**R11 tasks**
- [R11.1 — Multi-project fleet view](plans/R11/R11.1-multi-project-fleet-view.md)
- [R11.2 — Cost intelligence v2](plans/R11/R11.2-cost-intelligence-v2.md)
- [R11.3 — Cross-platform agent ingestion](plans/R11/R11.3-cross-platform-agent-ingestion.md)
- [R11.4 — Feature deprecation audit](plans/R11/R11.4-feature-deprecation-audit.md)

**R12 tasks**
- [R12.1 — AI-summarized digests + NL query](plans/R12/R12.1-nl-query-and-digests.md)
- [R12.2 — Git host sync (GitHub/GitLab)](plans/R12/R12.2-git-host-sync.md)
- [R12.3 — Information-density pass](plans/R12/R12.3-information-density-pass.md)

**R13 tasks**
- [R13.1 — Self-hostable team mode](plans/R13/R13.1-self-hostable-team-mode.md)
- [R13.2 — Docs + hero examples + homepage reposition](plans/R13/R13.2-docs-and-repositioning.md)

---

## 6. Risks

- **Anthropic's Agent Teams** could absorb orchestration mindshare.
  Mitigated by R11.3 — platform-agnostic ingestion makes Vibe Dash the
  layer *above* any vendor's agent runtime.
- **Scope creep via plugins.** R10's plugin system is a temptation to say
  *"plugin that"* for everything. R11.4 is the forcing function.
- **Vibe Kanban's visual polish** will out-market Vibe Dash on looks.
  Accept it — compete on intelligence and density, not pixels.
- **"All projects at once" implies a discovery story.** Vibe Dash
  currently waits for agents to report. R11.1 needs a passive discovery
  mechanism (scan a projects directory, watch git hooks) so new projects
  appear without bespoke wiring.

---

## Sources

- [AI observability tools buyer's guide 2026 — Braintrust](https://www.braintrust.dev/articles/best-ai-observability-tools-2026)
- [15 AI Agent Observability Tools in 2026 — AIMultiple](https://aimultiple.com/agentic-monitoring)
- [7 Best AI Agent Observability Tools for Coding Teams — Augment Code](https://www.augmentcode.com/tools/best-ai-agent-observability-tools)
- [Best AI Observability Tools for Autonomous Agents 2026 — Arize](https://arize.com/blog/best-ai-observability-tools-for-autonomous-agents-in-2026/)
- [Vibe Coding in 2026 — daily.dev](https://daily.dev/blog/vibe-coding-how-ai-changing-developers-code)
- [10 Best Vibe Coding Tools 2026 — roadmap.sh](https://roadmap.sh/vibe-coding/best-tools)
- [Vibe Kanban — BrightCoding](https://www.blog.brightcoding.dev/2026/04/19/vibe-kanban-10x-your-ai-coding-agent-output)
- [Claude Code Hooks Multi-Agent Observability — disler](https://github.com/disler/claude-code-hooks-multi-agent-observability)
- [Overstory — jayminwest](https://github.com/jayminwest/overstory)
- [Agents Observe — simple10](https://github.com/simple10/agents-observe)
- [Agent Orchestrator — Composio](https://github.com/ComposioHQ/agent-orchestrator)
- [Orchestrate teams of Claude Code sessions — Anthropic Docs](https://code.claude.com/docs/en/agent-teams)
- [The Code Agent Orchestra — Addy Osmani](https://addyosmani.com/blog/code-agent-orchestra/)
- [AI Coding Agent Dashboard — Marc Nuri](https://blog.marcnuri.com/ai-coding-agent-dashboard)
