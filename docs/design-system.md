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
