# Positioning: used open-source project, not portfolio piece

**Status:** Decided
**Date:** 2026-08-09
**Supersedes:** [docs/decisions/2026-05-strategic-positioning.md](2026-05-strategic-positioning.md)
**Source:** [docs/superpowers/specs/2026-08-09-transcript-ingestion-design.md](../superpowers/specs/2026-08-09-transcript-ingestion-design.md)

## Context

The 2026-05 decision capped Vibe Dash at "portfolio piece": a polished,
public demonstration of agent-orchestration thinking, not a product with
external users. Every scope call since then used that cap's test: does this
make the demo better, or only matter to a paying customer?

Two things changed. First, the transcript-ingestion design work surfaced a
real competitive gap: self-reported task boards (vibe-kanban, Backlog.md,
claude-task-master, Nimbalyst) share Vibe Dash's own trust problem, and
passive meters (ccusage, the OpenTelemetry stacks) read real data but carry
no task model at all, so nobody occupies the overlap of the two. Second, the
two largest projects in the category have gone quiet: Bloop shut down on
2026-04-10, and vibe-kanban (27.7k stars) is now community maintained with no
commits since 2026-04-24. That is a market opening, not proof of demand, but
it is a reason to reconsider a scope cap that was written before it existed.

## D1. Vibe Dash is now a used open-source project, not a portfolio piece

The portfolio cap and its test are lifted. Adoption now counts, which makes
discoverability, durability, and contributor experience legitimate concerns
where previously they were explicitly out of scope.

**Rejected:** keeping the portfolio cap and publishing the competitive
analysis as one of the two long-form posts the 2026-05 decision already
listed as exit criteria. That remains a good idea on its own and is not
blocked by this change; it simply stops being the only reason the analysis
was done.

## D2. The wedge is trustworthy data, alongside any runner

Vibe Dash observes and coordinates. It does not launch agents into
worktrees, review diffs, or merge them. Positioning stays explicitly beside
whatever runner the user already prefers, rather than replacing it.

**Rejected:** building execution to become a direct vibe-kanban replacement.
That competes on the strongest axis of Nimbalyst, Conductor, Agent Kanban,
and container-use, from behind, with one maintainer, and it is also the axis
a funded competitor defends most easily.

**Rejected:** leading with a git-native markdown task store. That answers
Backlog.md, the healthiest project in the category, but the niche is already
occupied and the differentiation is thinner.

## Consequences

- Future scope calls no longer use the "does this make the demo better"
  test. Discoverability, durability, and contributor experience are now
  legitimate reasons to do something.
- Vibe Dash does not grow an execution layer (worktree launching, diff
  review, merge automation). Anything that competes directly with the
  runners named above stays out of scope under D2.
- `docs/decisions/2026-05-strategic-positioning.md` is kept for the
  reasoning that led to the original "portfolio piece" call, marked
  superseded rather than deleted.
