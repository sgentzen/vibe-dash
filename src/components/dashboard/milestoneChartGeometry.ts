export interface BarPosition {
  date: string;
  leftPct: number;
  widthPct: number;
}

// Positions each daily-stats bar along a true time axis. leftPct is the point's
// fraction of the total [first,last] span; widthPct gives each bar a small,
// uniform footprint centered on its position so bars stay visible even when
// dates cluster. Guards single/empty inputs against divide-by-zero.
export function computeBarLayout(dates: string[], opts?: { minPct?: number }): BarPosition[] {
  if (dates.length === 0) return [];
  const barW = opts?.minPct ?? 4; // visual width of each bar, in % of the axis
  const times = dates.map((d) => new Date(d).getTime());
  const first = times[0];
  const last = times[times.length - 1];
  const span = last - first || 1; // 1ms avoids /0 for a single date
  return dates.map((date, i) => {
    const frac = (times[i] - first) / span; // 0..1
    // Keep bars fully inside [0,100] by insetting the centerline by half a bar.
    const center = barW / 2 + frac * (100 - barW);
    return { date, leftPct: center - barW / 2, widthPct: barW };
  });
}
