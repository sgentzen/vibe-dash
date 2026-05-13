# Defer Tauri menu-bar/tray app to Tier-B bets backlog

**Date:** 2026-05-12
**Task:** vibe-dash e358b854 (Tauri menu-bar/tray app — Tier-B bet)
**Status:** Deferred (task stays `planned`, removed from active milestone scope).

## Decision

Do not complete the Tauri tray app in the **May 2026 Brainstorm — Cuts, Gaps & Verification** milestone. The task remains in vibe-dash with `status: planned` and should be either moved to a new "Tier-B bets" milestone in a follow-up admin pass, or pulled back into scope when the strategic priorities shift.

## Why

1. **Out of scope for the milestone.** The May 2026 milestone is explicitly about *cuts, gaps, and verification* — pruning the MCP surface, consolidating views, hardening the model. A new desktop runtime is the opposite shape of work.
2. **Strategic positioning says no, for now.** Per [docs/decisions/2026-05-strategic-positioning.md](2026-05-strategic-positioning.md), the project is being treated as a **portfolio piece**. A tray app is a product feature for daily users, not a portfolio demonstration of agent-orchestration thinking. Time spent on Tauri does not improve the demo.
3. **Multi-session footprint.** Bootstrapping Tauri (toolchain install, icon assets, code signing, auto-update plumbing, release scripts) is plausibly 2–5 sessions of work. Compressing it into the tail of this milestone would force corners.
4. **No user pull.** The interview guide ([docs/research/2026-05-active-projects-interview-guide.md](../research/2026-05-active-projects-interview-guide.md)) is still pending execution. Building a tray app before knowing whether users want a tray app inverts the order.

## What stays true if priorities change

- If the strategic positioning shifts from portfolio piece → real product, Tauri moves from "deferred" to "in scope" without requiring a re-design.
- The FleetView consolidation that just shipped is unaffected by Tauri's status — it works equally well as a browser tab or as a tray-app window.
- If Tauri is revived, scope a first slice tightly: macOS-only, no auto-update, just a shell that loads `http://localhost:3001`. Get to a screenshot in one session.

## Action items for the next admin pass

- [ ] Create a "Tier-B bets" milestone in vibe-dash with `target_date: null` (or far-future).
- [ ] Move task e358b854 (`milestone_id` update) to that milestone.
- [ ] When closing the May 2026 milestone via `complete_milestone`, note in activity that e358b854 was moved, not abandoned.

## Why this doc instead of just marking the task done

Marking the task `done` would be dishonest: the work isn't done, the decision is "don't do it now." Vibe-dash lacks a `deferred`/`cancelled` status, so the next-best honest state is `planned` with this doc as the rationale. Future me (or the next session) can read this doc, decide, and act.
