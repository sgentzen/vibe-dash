import { useId, useState } from "react";

/**
 * A caveat rendered beside the figure it qualifies.
 *
 * Renders nothing unless the count is a finite number above zero. That guard
 * lives here, in one place, rather than at each call site: a caveat that is
 * always on screen becomes furniture and stops being read, so it would be
 * least effective exactly when it finally means something.
 *
 * The count is validated rather than trusted because these cards render in a
 * tree with no ErrorBoundary. One bad value from an older server would
 * otherwise blank the whole dashboard instead of one badge.
 *
 * The explanation is not a `title` attribute. A title reaches a mouse and
 * nothing else: it is announced inconsistently across NVDA/JAWS/VoiceOver and
 * never opens on keyboard focus, which fails WCAG 1.4.13 and 4.1.2. So the
 * badge is a real button carrying a described tooltip:
 *
 *   - the visible text is the accessible name ("7 unpriced"), the what;
 *   - the explanation is the accessible description, the why, which is the
 *     part that decides whether a reader should trust the figure beside it;
 *   - the description is always in the DOM, only visually hidden, so a screen
 *     reader gets it without having to discover a hover;
 *   - it becomes visible on focus as well as hover, so a sighted keyboard user
 *     gets it too, and Escape dismisses it.
 *
 * The button shape follows MetricInfoTip, but the third point above is a
 * deliberate departure from it: MetricInfoTip renders its tooltip element only
 * while visible, so its description leaves the accessibility tree when closed.
 * Keeping the element mounted is the whole reason aria-describedby resolves
 * here without a hover, so do not "align" this with that component.
 *
 * The pointer handlers sit on the wrapper, not the button, so the tooltip
 * survives the mouse travelling onto it (1.4.13 "hoverable"). The focus ring is
 * left to the browser rather than styled away.
 */
export function CountBadge({
  count,
  label,
  explanation,
  tone = "var(--accent-purple)",
}: Readonly<{
  count: number | null | undefined;
  label: string;
  explanation: string;
  tone?: string;
}>) {
  const tipId = useId();
  // Pointer and focus are tracked apart rather than as one `visible` boolean.
  // Sharing one made whichever input ended last win: tabbing to the badge
  // opened the tooltip, and then nudging the mouse off it closed it again while
  // the badge was still focused. 1.4.13 requires the opposite, that the content
  // survives until focus leaves or the user dismisses it, so the tooltip shows
  // while either input is on it and `dismissed` is the only thing that overrides.
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const visible = (hovered || focused) && !dismissed;

  if (typeof count !== "number" || !Number.isFinite(count) || count <= 0) return null;

  return (
    <span
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setDismissed(false);
      }}
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        marginLeft: "4px",
      }}
    >
      <button
        type="button"
        aria-describedby={tipId}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setDismissed(false);
        }}
        // A pointer user is already hovering by the time they click, and a
        // keyboard or touch user gets here through focus, so a click only has
        // to undo an earlier Escape. It must not set `focused` itself: no blur
        // would follow in the browsers that do not focus a clicked button, and
        // the tooltip would stick open with nothing left to close it.
        onClick={() => setDismissed(false)}
        onKeyDown={(e) => {
          // Escape dismisses without moving focus (1.4.13). The handler sits on
          // the button, not the wrapper: focus is here whenever a keyboard user
          // has the tooltip open, and a wrapper span with a key handler is a
          // non-native interactive element. Swallowing the key is deliberate but
          // only while the tooltip is open, so Escape still reaches an enclosing
          // drawer whenever the badge is merely focused.
          if (e.key === "Escape" && visible) {
            e.stopPropagation();
            setDismissed(true);
          }
        }}
        style={{
          background: "none",
          border: "none",
          padding: 0,
          font: "inherit",
          lineHeight: "inherit",
          color: tone,
          cursor: "help",
          whiteSpace: "nowrap",
        }}
      >
        {count} {label}
      </button>
      <span
        id={tipId}
        role="tooltip"
        style={
          visible
            ? {
                position: "absolute",
                bottom: "calc(100% + 4px)",
                left: "50%",
                transform: "translateX(-50%)",
                background: "var(--bg-primary)",
                border: "1px solid var(--border)",
                borderRadius: "6px",
                padding: "6px 8px",
                fontSize: "11px",
                color: "var(--text-secondary)",
                whiteSpace: "pre-wrap",
                maxWidth: "220px",
                zIndex: 100,
                boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
                lineHeight: "1.4",
              }
            : VISUALLY_HIDDEN
        }
      >
        {explanation}
      </span>
    </span>
  );
}

/**
 * Off-screen but still in the accessibility tree, so `aria-describedby` has
 * something to point at even while the tooltip is closed. `display: none` or
 * `visibility: hidden` would remove it from that tree and take the description
 * with it.
 */
const VISUALLY_HIDDEN = {
  position: "absolute",
  width: "1px",
  height: "1px",
  margin: "-1px",
  padding: 0,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
  border: 0,
} as const;
