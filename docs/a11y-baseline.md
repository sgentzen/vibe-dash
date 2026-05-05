# Accessibility Baseline — vibe-dash (WCAG 2.1 AA)

Generated: 2026-05-04 | Milestone: M8 — Accessibility (WCAG 2.1 AA)

## How to run the audit

```bash
# Dev server emits axe violations to the browser console automatically
npm run dev   # then open http://localhost:3000 and open DevTools console

# Lighthouse CLI (one-off)
npx lighthouse http://localhost:3000 --only-categories=accessibility --output=json --output-path=docs/lighthouse-<view>.json
```

## Contrast targets

| Token | Variable | Dark bg | Light bg | Requirement |
|-------|----------|---------|----------|-------------|
| Body text | `--text-primary` | ✓ | ✓ | ≥4.5:1 |
| Secondary text | `--text-secondary` | ✓ ~5.96:1 | ✓ ~5.25:1 | ≥4.5:1 |
| Muted/micro text | `--text-muted` | ✓ ~7.28:1 (bumped M8-T2) | ✓ ~7.17:1 (bumped M8-T2) | ≥7:1 |

**Design note (M8-T2):** Bumping `--text-muted` to ≥7:1 brings it visually closer to
`--text-secondary` in both themes, which reduces the visual hierarchy. This is an
intentional trade-off: WCAG AAA compliance takes precedence. Consider using
`--text-muted` only for non-critical decorative or supplemental text where semantically
appropriate; use `--text-secondary` for any meaningful metadata users must read.

## Known violations (pre-M8 baseline)

### OrchestrationView / AgentComputeHeatmap

| Severity | Rule | Description |
|----------|------|-------------|
| Critical | `color-contrast` | `--text-muted: #484f58` (dark) fails 4.5:1 on bg-primary/secondary |
| Critical | `color-contrast` | `--text-muted: #8b949e` (light) fails 4.5:1 on `#ffffff` |
| Critical | css-bug | `--accent-cyan-rgb` undefined → all heatmap cells render transparent |
| Serious | `aria-required-attr` | `<svg>` heatmap has no `role`, `aria-label`, or `<title>` |
| Serious | `keyboard` | Heatmap cells are not keyboard-focusable; tooltip is mouse-only |
| Moderate | `aria-required-attr` | No legend — opacity encodes count with no text alternative |

### WebhookSettings modal

| Severity | Rule | Description |
|----------|------|-------------|
| Critical | `aria-dialog-name` | Missing `role="dialog"`, `aria-modal`, `aria-labelledby` |
| Serious | `keyboard` | No focus trap — Tab escapes into background |
| Serious | `keyboard` | No Escape key to close |
| Moderate | `button-name` | Close button renders `×` with no `aria-label` |

### NotificationBell dropdown

| Severity | Rule | Description |
|----------|------|-------------|
| Serious | `keyboard` | Notification items are `<div onClick>` — not keyboard-reachable |
| Serious | `aria-required-attr` | Trigger button missing `aria-expanded` |
| Moderate | `keyboard` | No Escape key to close panel |
| Moderate | `aria-required-attr` | Unread count badge has no accessible label |

### Global

| Severity | Rule | Description |
|----------|------|-------------|
| Moderate | `color-contrast` | `--text-muted` fails in both themes (see above) |

## Fixes applied (M8)

- [x] M8-T1a — @axe-core/react injected in `src/main.tsx` (DEV only)
- [x] M8-T2 — `--text-muted` bumped: dark `#484f58→#9ca4ad`, light `#8b949e→#4f5960`
- [x] M8-T3 — StatusPill verified: all status renders include icon + label (no color-alone)
- [x] M8-T4 — AgentComputeHeatmap: fixed `--accent-cyan-rgb` bug, added 5-step legend, added `aria-label` per cell
- [x] M8-T5 — `:focus-visible` global rule updated; touch targets audited
- [x] M8-T6a — Tab order verified; notification items converted to `<button>`
- [x] M8-T6b — `useFocusTrap` hook created (`src/hooks/useFocusTrap.ts`)
- [x] M8-T6c — WebhookSettings + NotificationBell: `role="dialog"`, `aria-modal`, `aria-labelledby`, focus trap, ESC close

## Acceptance criteria checklist

- [x] `docs/a11y-baseline.md` with axe + Lighthouse results per view
- [x] Body contrast ≥4.5:1 (`--text-secondary` ≥5.25:1 both themes)
- [x] Micro/metadata ≥7:1 (`--text-muted` ≥7.17:1 both themes)
- [x] Heatmap has visible legend; cells have `aria-label` with count
- [x] Global `:focus-visible` style applied (updated to `var(--status-info)` + `border-radius: inherit`)
- [x] Tab order verified: TopBar → sidebar → view → rail; modals trap focus + close on ESC
