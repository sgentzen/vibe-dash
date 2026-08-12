import { useEffect, useId, useState } from "react";

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
}: Readonly<{
  count: number | null | undefined;
  label: string;
  explanation: string;
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

  // Escape has to reach a pointer user too. Hovering never focuses the button,
  // so the button's own onKeyDown below only ever sees the key when a keyboard
  // user opened the tooltip; for a mouse user the keydown lands on the body and
  // that handler never runs. The tooltip covers the content above it, so
  // without this the only way to be rid of it is to move the pointer, which is
  // precisely what 1.4.13 "dismissible" says must not be required.
  useEffect(() => {
    if (!visible) return;
    const onDocumentKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDismissed(true);
    };
    document.addEventListener("keydown", onDocumentKeyDown);
    return () => document.removeEventListener("keydown", onDocumentKeyDown);
  }, [visible]);

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
          // Escape dismisses without moving focus (1.4.13). The document
          // listener above already closes the tooltip; this handler exists for
          // the stopPropagation, which is what stops a badge inside a drawer
          // from letting the same Escape close the drawer out from under it.
          // Swallowing the key is deliberate but only while the tooltip is
          // open, so Escape still reaches the drawer whenever the badge is
          // merely focused.
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
          color: BADGE_COLOUR,
          cursor: "help",
          whiteSpace: "nowrap",
        }}
      >
        {count} {label}
      </button>
      <span
        id={tipId}
        // Only a tooltip once it is actually showing. While closed this is just
        // the text `aria-describedby` points at, and a permanent node announcing
        // itself as a tooltip is one more thing for a browse-mode reader to trip
        // over on its way past the badge.
        role={visible ? "tooltip" : undefined}
        style={
          visible
            ? {
                // The 4px clearance is padding rather than an offset, so the
                // box reaches down to the button. Held apart by `bottom` it left
                // a dead strip the pointer had to cross, and crossing it fired
                // mouseleave on the wrapper and closed the tooltip before the
                // pointer arrived, which is the "hoverable" half of 1.4.13.
                position: "absolute",
                bottom: "100%",
                left: "50%",
                transform: "translateX(-50%)",
                paddingBottom: "4px",
                zIndex: 100,
              }
            : VISUALLY_HIDDEN
        }
      >
        <span
          style={
            visible
              ? {
                  display: "block",
                  background: "var(--bg-primary)",
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                  padding: "6px 8px",
                  fontSize: "11px",
                  color: "var(--text-secondary)",
                  whiteSpace: "pre-wrap",
                  maxWidth: "220px",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
                  lineHeight: "1.4",
                }
              : undefined
          }
        >
          {explanation}
        </span>
      </span>
    </span>
  );
}

/**
 * One colour for every badge, not a per-call-site choice.
 *
 * It was a `tone` prop defaulting to `--accent-purple`, and the one call site
 * that took the default rendered #8b5cf6 on `--bg-secondary` = 4.09:1, under
 * the 4.5:1 WCAG 1.4.3 requires of this 11px text. `--text-muted` is documented
 * in App.css as bumped to >=7:1 precisely for micro text like this.
 *
 * Any replacement must clear 4.5:1 against `--bg-secondary` in BOTH themes.
 * Check the darker of the two first: a colour can pass in light and fail in
 * dark, which is exactly how the accent slipped through.
 */
const BADGE_COLOUR = "var(--text-muted)";

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
