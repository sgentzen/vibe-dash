import type { CSSProperties } from "react";

interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  style?: CSSProperties;
}

export function Sparkline({ values, width = 48, height = 14, color = "var(--accent-green)", style }: SparklineProps) {
  if (values.length < 2) return null;

  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const pad = 1;

  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * (width - pad * 2) + pad;
      const y = height - pad - ((v - min) / range) * (height - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const lastX = ((values.length - 1) / (values.length - 1)) * (width - pad * 2) + pad;
  const lastY = height - pad - ((values[values.length - 1] - min) / range) * (height - pad * 2);

  return (
    <svg
      width={width}
      height={height}
      style={{ overflow: "visible", flexShrink: 0, ...style }}
      aria-hidden="true"
    >
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.7"
      />
      <circle cx={lastX} cy={lastY} r="1.5" fill={color} opacity="0.9" />
    </svg>
  );
}

export function buildDailyActivityCounts(
  timestamps: string[],
  days = 7
): number[] {
  const now = Date.now();
  const counts = Array(days).fill(0);
  for (const ts of timestamps) {
    const age = now - new Date(ts).getTime();
    const dayIndex = Math.floor(age / 86_400_000);
    if (dayIndex >= 0 && dayIndex < days) {
      counts[days - 1 - dayIndex]++;
    }
  }
  return counts;
}
