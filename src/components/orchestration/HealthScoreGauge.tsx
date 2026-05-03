import { useMemo } from "react";

interface Props {
  done: number;
  total: number;
  unresolvedBlockers: number;
}

function scoreToColor(score: number): string {
  if (score >= 80) return "var(--accent-green)";
  if (score >= 60) return "var(--accent-blue)";
  if (score >= 40) return "var(--accent-yellow)";
  return "var(--accent-red)";
}

export function HealthScoreGauge({ done, total, unresolvedBlockers }: Props) {
  const score = useMemo(() => {
    const completion = total > 0 ? done / total : 0;
    const blockerPenalty = Math.min(unresolvedBlockers * 0.05, 0.3);
    return Math.round(Math.max(0, completion - blockerPenalty) * 100);
  }, [done, total, unresolvedBlockers]);

  const color = scoreToColor(score);

  // SVG arc math: 240° sweep, radius 80, viewBox 200x130
  // Start angle: -210° (7 o'clock), end angle: 30° (5 o'clock)
  const cx = 100;
  const cy = 105;
  const r = 72;
  const strokeWidth = 10;
  const startAngleDeg = -210;
  const sweepDeg = 240;

  const circumference = 2 * Math.PI * r;
  const arcLength = (sweepDeg / 360) * circumference;

  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const startRad = toRad(startAngleDeg);

  // Convert polar to cartesian
  const px = (angle: number) => cx + r * Math.cos(angle);
  const py = (angle: number) => cy + r * Math.sin(angle);

  const x1 = px(startRad);
  const y1 = py(startRad);
  const endRad = toRad(startAngleDeg + sweepDeg);
  const x2 = px(endRad);
  const y2 = py(endRad);

  const largeArc = sweepDeg > 180 ? 1 : 0;

  const arcPath = `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`;

  // Foreground: fill from 0 to score using dashoffset
  const fillLength = (score / 100) * arcLength;
  const dashOffset = arcLength - fillLength;

  return (
    <div className="orch-card" style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div className="orch-section-header" style={{ marginBottom: "8px" }}>Project Health Score</div>
      <svg viewBox="0 0 200 130" width="180" height="117" style={{ overflow: "visible" }}>
        {/* Background track */}
        <path
          d={arcPath}
          fill="none"
          stroke="var(--border)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
        {/* Foreground arc */}
        <path
          d={arcPath}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${arcLength}`}
          strokeDashoffset={dashOffset}
          style={{
            filter: `drop-shadow(0 0 6px ${color})`,
            transition: "stroke-dashoffset 600ms ease-out, stroke 300ms ease",
          }}
        />
        {/* Center score */}
        <text
          x={cx}
          y={cy - 6}
          textAnchor="middle"
          fontSize="38"
          fontWeight="600"
          fill="var(--text-primary)"
        >
          {score}
        </text>
        <text
          x={cx}
          y={cy + 14}
          textAnchor="middle"
          fontSize="10"
          fontWeight="600"
          fill="var(--text-muted)"
          letterSpacing="0.1em"
        >
          HEALTH
        </text>
      </svg>
    </div>
  );
}
