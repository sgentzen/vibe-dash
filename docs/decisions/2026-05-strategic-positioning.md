# Strategic positioning: hobby vs portfolio piece vs real product

**Status:** Decided (Portfolio piece)
**Date:** 2026-05-12
**Milestone:** May 2026 Brainstorm — Cuts, Gaps & Verification
**Task:** vibe-dash 12b0ca7f

## Context

Vibe Dash sits at an inflection point. The May brainstorm milestone cut the MCP surface from 80 tools to ~10 + extended namespace, removed plugin/template/alert-rule dead code, and shipped detector framework + Tier 1 detectors, daily digest, `vibe status` CLI, and M3 top-nav chrome. The remaining open tasks (FleetView consolidation, Tier 2 detectors, Tauri tray app) imply meaningfully different effort envelopes depending on what this project is *for*. This brief frames the choice so future scope calls are anchored.

## Options

### Option A — Hobby

Treat vibe-dash as a personal dashboard. Ship what feels good; no external users; no SLA; no marketing.

- **Scope cap:** single-user, single-machine, SQLite, no auth.
- **Infra cost:** $0/mo.
- **Time:** weekends only; OK to drop for months.
- **Exit criteria:** if you stop using it, archive the repo.
- **Implies:** kill Tauri (browser tab is fine), keep auth gated off via `VIBE_TEAM_MODE`, FleetView is nice-to-have, Tier 2 detectors are nice-to-have.

### Option B — Portfolio piece *(recommended)*

Treat vibe-dash as a public, polished demonstration of agent-orchestration thinking — referenced from a CV, blog posts, or talks. Not a SaaS, but built to a standard that survives a serious code review.

- **Scope cap:** local-first, single-tenant; optional team mode behind a flag; documented setup; comprehensive tests; written design rationale checked in.
- **Infra cost:** $0–$20/mo (domain + landing page).
- **Time:** ~5–10h/week, sustained.
- **Exit criteria:** v1.0 tag, public README with screenshots, two long-form posts on detectors and the MCP-cut decision.
- **Implies:** ship FleetView (consolidation is the kind of opinionated UX call that demos well), ship Tier 2 detectors (closes the detector-framework story), defer Tauri (tray app is a product feature, not a portfolio one).

### Option C — Real product

Multi-tenant SaaS or self-host distribution with paying users.

- **Scope cap:** auth, multi-tenant isolation, billing, support, on-call.
- **Infra cost:** $50–500/mo plus engineering overhead for compliance.
- **Time:** 20+ h/week, structural.
- **Exit criteria:** $1k MRR or a clear acquisition signal within 6 months.
- **Implies:** rewrite auth from `VIBE_TEAM_MODE` flag to real RBAC; pick a hosting story; Tauri becomes a serious paid-tier feature; user research becomes mandatory (and recurring).

## Signals from current state

- Shipped the `vibe status` CLI and daily digest writer — both are "polished personal tooling" outputs, not "SaaS" outputs.
- M2 (semantic color tokens) and M3 (top nav) prioritized design quality over feature breadth — consistent with portfolio framing.
- 80→10 MCP cut is an opinionated, narratable decision — portfolio gold.
- Active project count is 1 (the project itself); no external users in the data.
- Auth middleware exists but is gated behind a flag — neither hobby (would be deleted) nor real product (would be production-ready).

The data points consistently to Option B.

## Decision

**Option B — Portfolio piece.**

The work pattern across April and May is already operating at portfolio-piece intensity. Making it explicit means future scope decisions get a clear test: "does this make the demo better, or only matter to a paying customer?" — the latter waits.

## Consequences

- FleetView consolidation (7ef6593a) and Tier 2 detectors (d087c692) ship in this milestone.
- Tauri tray app (e358b854) is **deferred to a new "Tier-B bets" milestone** rather than completed in this one.
- `VIBE_TEAM_MODE` stays as-is (flag gated); not promoted to first-class auth.
- User research (4a66a39e) is reframed: the deliverable becomes a written interview guide for *future* use, not a blocker for current FleetView design (which uses Scott-as-user, n=1, with the explicit caveat documented).
- Next milestone after this one should be a "v1.0 readiness" milestone: README polish, screenshots, two design-rationale posts.
