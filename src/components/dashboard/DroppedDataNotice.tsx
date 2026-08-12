/**
 * The line that exists for exactly one reason: a local process can fill
 * `otlp_series` to its ceiling with zero-valued points. Those create series
 * rows but write no cost rows, so the flood produces no signal anywhere else
 * on the dashboard -- no total moves, no badge appears. From then on every
 * new sender is refused and its spend is never recorded. `otlpSeriesCount`
 * and `otlpSeriesRefused` on `GET /api/ingest/status` are the only evidence
 * that exists, and this component is the only thing that shows them to a
 * reader.
 *
 * Renders nothing unless there is something to say -- the same rule as
 * `CountBadge`, applied to a caveat with no host figure to sit beside. A
 * notice that is always on screen becomes furniture and stops being read, so
 * it would be least effective exactly when it finally means something.
 *
 * Every count is read through the same guard as `CountBadge`: not a finite
 * number is treated as zero, never rendered raw. These components sit in a
 * tree with no ErrorBoundary, so one bad value from an older or malformed
 * response must degrade to "nothing to report" rather than blank the page.
 *
 * Styled as a notice, not an alarm. This is information about data that was
 * never recorded, not a failure of the application: muted text and a subtle
 * border rather than a warning colour.
 */

/** Not a finite number is treated as zero, matching CountBadge's guard. */
function safeCount(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** Only for a server that does not publish its cap. See the prop's comment. */
const FALLBACK_SERIES_CAP = 10_000;

/**
 * The server's ceiling when it published a usable one, the fallback otherwise.
 *
 * A default parameter would only cover `undefined`, and a non-finite number
 * comes back from JSON as `null`. `seriesCount >= null` is `true` for a count
 * of zero, so a healthy install would have announced itself at capacity: a
 * caveat firing when it should not, which on this path is as bad as one that
 * fails to fire.
 */
function safeCap(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : FALLBACK_SERIES_CAP;
}

export function DroppedDataNotice({
  otlpUnmapped,
  otlpSeriesRefused,
  otlpSeriesCount,
  seriesCap,
}: Readonly<{
  otlpUnmapped?: number | null;
  otlpSeriesRefused?: number | null;
  otlpSeriesCount?: number | null;
  /**
   * The ceiling the SERVER is enforcing, from GET /api/ingest/status.
   *
   * Falls back only for a server too old to publish it, or one that published
   * something unusable. Carrying a copy of the real number here would make
   * this notice announce "at capacity" against the wrong ceiling as soon as an
   * operator raised the cap, which is exactly the remedy they reach for when
   * this fires.
   */
  seriesCap?: number | null;
}>) {
  const unmapped = safeCount(otlpUnmapped);
  const refused = safeCount(otlpSeriesRefused);
  const seriesCount = safeCount(otlpSeriesCount);
  const cap = safeCap(seriesCap);
  const atCeiling = seriesCount >= cap;

  if (unmapped <= 0 && refused <= 0 && !atCeiling) return null;

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: "8px",
        padding: "var(--space-3) var(--space-4)",
        marginBottom: "var(--space-4)",
        color: "var(--text-muted)",
        fontSize: "12px",
        lineHeight: 1.5,
      }}
    >
      <ul style={{ margin: 0, paddingLeft: "1.2em" }}>
        {unmapped > 0 && (
          <li>
            {unmapped} {unmapped === 1 ? "point was" : "points were"} ignored because no mapper recognised the
            sending runner (<code>otlpUnmapped</code> on <code>GET /api/ingest/status</code>).
          </li>
        )}
        {refused > 0 && (
          <li>
            {refused} {refused === 1 ? "point was" : "points were"} refused because the OTLP series cap is full
            (<code>otlpSeriesRefused</code> on <code>GET /api/ingest/status</code>).
          </li>
        )}
        {atCeiling && (
          <li>
            The OTLP series table is at its ceiling: {seriesCount} of {cap} series (
            <code>otlpSeriesCount</code> on <code>GET /api/ingest/status</code>). New senders are being refused
            until the cap is raised.
          </li>
        )}
      </ul>
      <p style={{ margin: "var(--space-2) 0 0 0" }}>
        <code>otlpUnmapped</code> and <code>otlpSeriesRefused</code> reset to zero on restart; <code>otlpSeriesCount</code>{" "}
        does not, so comparing a small refused count against a large series count understates how long this has
        been going on. See{" "}
        <a
          href="https://github.com/sgentzen/vibe-dash/blob/main/docs/ingestion.md"
          target="_blank"
          rel="noreferrer"
          style={{ color: "inherit" }}
        >
          docs/ingestion.md
        </a>
        .
      </p>
    </div>
  );
}
