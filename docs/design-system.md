# Vibe Dash Design System

## Token Hierarchy

```
--accent-*        Branded UI (buttons, links, chart bars, logos)
--status-*        State / health / alert indicators
--text-*          Typography
--bg-*            Surfaces and backgrounds
--border          Dividers
--shadow-*        Elevation
```

**Rule:** Use `--status-*` wherever the color communicates a state or health condition.
Use `--accent-*` only for branded UI elements (buttons, nav highlights, data-viz bars).

---

## Status Tokens

Defined in `src/App.css` (`:root` and `[data-theme="light"]`), aliased from `--accent-*`.

| Token               | Value (dark)       | Semantic meaning              |
|---------------------|--------------------|-------------------------------|
| `--status-success`  | `--accent-green`   | Healthy, active, done, on track |
| `--status-warning`  | `--accent-yellow`  | At risk, idle, blocked (soft) |
| `--status-danger`   | `--accent-red`     | Error, overdue, blocked (hard) |
| `--status-info`     | `--accent-blue`    | Informational, complete/done  |
| `--status-neutral`  | `--text-muted`     | Inactive, planned, offline    |

---

## Status → Token Maps

Defined in `src/constants/statusTokens.ts`.

### Task status

| Status       | Token     |
|--------------|-----------|
| `planned`    | `neutral` |
| `in_progress`| `success` |
| `blocked`    | `danger`  |
| `done`       | `info`    | Blue distinguishes "done" from "active" (both good states); green is reserved for in-progress work |

### Milestone health

| Health     | Token     |
|------------|-----------|
| `on_track` | `success` |
| `at_risk`  | `warning` |
| `behind`   | `danger`  |

### Agent health

| Health    | Token     |
|-----------|-----------|
| `active`  | `success` |
| `idle`    | `warning` |
| `offline` | `neutral` |

### Helper

```ts
import { tokenToColor } from "../constants/statusTokens.js";
tokenToColor("success"); // → "var(--status-success)"
```

---

## StatusPill Component

`src/components/StatusPill.tsx`

```tsx
<StatusPill token="success" label="Active" />
<StatusPill token="warning" label="At Risk" size="md" />
```

| Prop    | Type          | Default | Description              |
|---------|---------------|---------|--------------------------|
| `token` | `StatusToken` | —       | Controls color and icon  |
| `label` | `string`      | —       | Text shown in the pill   |
| `size`  | `"sm" \| "md"` | `"sm"` | Font size (10px / 12px)  |

Icons per token: `success` ✓ · `warning` ⚠ · `danger` ✗ · `info` ● · `neutral` ○

---

## Shadow / Glow Tokens

| Token                 | Use case                          |
|-----------------------|-----------------------------------|
| `--shadow-glow-green` | Active task card border glow      |
| `--shadow-glow-red`   | Overdue / error card border glow  |
| `--shadow-glow-yellow`| Warning state glow                |
| `--shadow-glow-blue`  | Info / done state glow            |

---

## Page Title Casing

**Convention:** Sentence case for page titles; uppercase tracked-out for section labels.

| Element | Casing | Example |
|---------|--------|---------|
| Page `<h1>` / `<h2>` title | Sentence case | `Dashboard`, `Agent dashboard`, `Git worktrees` |
| Section label (e.g., `.orch-subheader-title`) | ALL CAPS tracked-out | `AI AGENT ORCHESTRATION OVERVIEW` |

**Do:**
```tsx
<h1>Orchestration</h1>                       {/* sentence case page title */}
<span className="section-label">AI AGENT ORCHESTRATION OVERVIEW</span>
```

**Don't:**
```tsx
<h1>Orchestration Overview</h1>              {/* too descriptive — save for section labels */}
<span className="section-label">Orchestration Overview</span>  {/* should be ALL CAPS tracked-out */}
```

Views without a visible page title (e.g., TaskBoard, TaskListView) are exempt only if the active view's name is visible in the top-bar ViewToggle — add a page title if the view ever renders standalone.

---

## CSS Variable Quick Reference

```css
/* Surfaces */
--bg-primary      /* page background */
--bg-secondary    /* card / panel background */
--bg-tertiary     /* input / tag background */

/* Text */
--text-primary    /* body copy */
--text-secondary  /* supporting text */
--text-muted      /* de-emphasized, labels */
--text-on-accent  /* text on colored backgrounds */

/* Structure */
--border          /* all dividers and borders */

/* Accent (branded only) */
--accent-blue --accent-green --accent-yellow
--accent-red  --accent-purple --accent-cyan
```

---

## Type Scale

Defined in `src/App.css` (`:root`). Use `typeScale.*` spread in React inline styles.

| Token            | Value          | Use                               |
|------------------|----------------|-----------------------------------|
| `--type-display` | `600 32px/1.2` | Hero numbers, large KPI values    |
| `--type-h1`      | `600 24px/1.3` | Page titles (reserved)            |
| `--type-h2`      | `600 18px/1.4` | View headings (WorktreeView, ExecutiveView) |
| `--type-body`    | `400 14px/1.5` | Default body copy, sub-headings   |
| `--type-caption` | `400 12px/1.4` | Card metadata, secondary labels   |
| `--type-micro`   | `500 11px/1.3` | Section headers, stat labels, badges |

> `--type-micro` also requires `letterSpacing: "0.05em"` and `textTransform: "uppercase"` — these are included in `typeScale.micro` (defined in `src/styles/shared.ts`).

### React inline style usage

`typeScale` is exported from `src/styles/shared.ts`.

```tsx
import { typeScale } from "../styles/shared.js";
<h2 style={{ ...typeScale.h2, color: "var(--text-primary)", margin: 0 }}>Git Worktrees</h2>
<span style={{ ...typeScale.micro, color: "var(--text-muted)" }}>PROJECTS</span>
```

---

## Spacing Scale

Defined in `src/App.css` (`:root`). Use as string literals in inline style properties.

| Token       | Value | Common use                            |
|-------------|-------|---------------------------------------|
| `--space-1` | 4px   | Icon gap, tight badge padding         |
| `--space-2` | 8px   | Button padding-block, list item gap   |
| `--space-3` | 12px  | Card inner gap, list item padding     |
| `--space-4` | 16px  | Card padding, section margin          |
| `--space-5` | 24px  | View padding (generous), section gap  |
| `--space-6` | 32px  | Large section separation              |
| `--space-7` | 48px  | Empty state padding                   |
| `--space-8` | 64px  | Page-level top padding                |
