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
 * The explanation is carried on aria-label as well as title. A title attribute
 * alone reaches a mouse and nothing else: it is not announced reliably by
 * screen readers and never appears on keyboard focus. The visible text says
 * what ("7 unpriced"); the label says why, which is the part that decides
 * whether a reader should trust the figure beside it.
 *
 * KNOWN LIMIT: a keyboard user still cannot summon the explanation, because a
 * native title tooltip does not open on focus. Closing that needs a real
 * tooltip component rather than a title attribute, which is more than this
 * badge should carry. Recorded rather than left for someone to rediscover.
 */
export function CountBadge({
  count,
  label,
  title,
  tone = "var(--accent-purple)",
}: Readonly<{
  count: number | null | undefined;
  label: string;
  title: string;
  tone?: string;
}>) {
  if (typeof count !== "number" || !Number.isFinite(count) || count <= 0) return null;

  return (
    <span
      title={title}
      aria-label={title}
      style={{ color: tone, marginLeft: "4px", cursor: "help", whiteSpace: "nowrap" }}
    >
      {count} {label}
    </span>
  );
}
