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
      style={{ color: tone, marginLeft: "4px", cursor: "help", whiteSpace: "nowrap" }}
    >
      {count} {label}
    </span>
  );
}
