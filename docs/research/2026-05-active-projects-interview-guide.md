# Interview guide: how many active projects do you juggle?

**Date:** 2026-05-12
**Task:** vibe-dash 4a66a39e
**Purpose:** Validate (or invalidate) the assumption that drives FleetView's 4-preset design — that real users juggle 3–7 active projects and need an at-a-glance "fleet" view rather than a per-project drilldown.

## Why this matters

FleetView is being designed for plural projects. If real users juggle 1–2 projects, FleetView is over-engineered. If they juggle 10+, the 4-preset model is too narrow and we need filtering or grouping. Three interviews is enough to disconfirm the assumption; it is not enough to ship a feature for a market.

## Screener

A qualified "non-Scott user" is someone who:

1. Has written code in the last 30 days.
2. Has at least 2 in-flight side projects, work streams, or repos they personally feel ownership of.
3. Has used at least one AI coding assistant (Claude Code, Cursor, Copilot, Aider, etc.) in the last 7 days.

If they don't pass all three, don't run the interview — the data won't generalize to vibe-dash's audience.

## Logistics

- **Length:** 25 minutes, no longer. Decline if they offer 60.
- **Format:** voice call, no slides, no screen share until question 4.
- **Recording:** ask explicit consent. If declined, take handwritten notes only.
- **Compensation:** if interviewing outside of friend/colleague network, $25 gift card. Inside the network, beverage of choice next time you meet.

### Consent script

> "I'm researching how people who use AI coding assistants juggle multiple projects. This is for a personal project, not commercial. I'd like to record the audio so I can write up notes accurately — the recording stays local on my machine and I'll delete it within 30 days. Anything you say can be paraphrased in a public post, but I'll never use your name or identifying details without asking you first. Sound OK?"

## The 5 questions

Ask in order. Don't skip ahead even if they answer Q3 while talking about Q1 — bring them back.

### Q1 — Count

> "Think about the last two weeks. How many distinct projects, repos, or work streams did you actively touch — not just look at, but actually push code, write a doc, or move a ticket on?"

*Probe:* What counts as "actively touched" for them? Make them name each one out loud.

### Q2 — Switching cost

> "Walk me through the last time you switched from one project to another in a single sitting. What did you have to reload in your head?"

*Probe:* What slows them down at the switch point — context, tooling state, mental model?

### Q3 — Status mental model

> "If I asked you right now to tell me which of your projects is most at-risk this week, could you? What would you base that on?"

*Probe:* Where do they get the signal — memory, a dashboard, Slack, calendar, a person?

### Q4 — Reaction to FleetView

*Now share screen.* Show the FleetView sketch ([docs/design/2026-05-fleetview-4-preset-sketch.md](../design/2026-05-fleetview-4-preset-sketch.md)) for 30 seconds without commentary.

> "Pretend this is a real product. What do you think it does? What would you click first?"

*Probe:* Do they understand "preset"? Do they reach for the right preset given the at-risk story from Q3?

### Q5 — Disconfirmation

> "What's missing from this that, if it existed, would make you actually use it daily?"

*Probe:* If they say "nothing" — push harder. If they say "everything" — ask what would they remove.

## Synthesis template

Fill this in after all 3 interviews are complete. Look for *patterns of 2+*, not single quotes.

```
## Interviewee A / B / C

- Pseudonym:
- Background (1 line):
- Active project count (Q1):
- Top switching pain (Q2):
- At-risk signal source (Q3):
- First click on FleetView (Q4):
- "Missing" thing (Q5):
- Surprising quote:

## Cross-cutting findings

- Active project count distribution: [list]
- Modal at-risk signal source:
- Was the 4-preset model legible without explanation? [yes / no / partial]
- Top requested addition:
- Top requested removal:

## Decisions

- [ ] FleetView 4-preset model: keep / revise / discard
- [ ] Add filtering by project count? [yes / no]
- [ ] At-risk signal: surface in which preset?
- [ ] Follow-up research needed?
```

## Recruiting list (placeholder — Scott fills in)

- [ ] Person A — channel, date
- [ ] Person B — channel, date
- [ ] Person C — channel, date

## Out-of-scope notes

- This is qualitative, not quantitative. Three interviews can tell you the assumption is wrong, but cannot prove it right. If FleetView ships and the assumption matters more, instrument usage and revisit.
- Do not ask leading questions ("would you find FleetView useful?" — bad. "Walk me through the last time you switched projects" — good).
- Avoid asking about features they "would like" — what people say they want and what they use are different categories.
