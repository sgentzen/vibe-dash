import {
  DAY_MS,
  MONTH_HEADER_HEIGHT,
  MONTH_NAMES,
  WEEK_HEADER_HEIGHT,
} from "./constants";
import { formatWeekLabel } from "./utils";

interface DateHeaderProps {
  minDate: Date;
  totalDays: number;
  timelineWidth: number;
  labelWidth: number;
}

export function DateHeader({ minDate, totalDays, timelineWidth, labelWidth }: DateHeaderProps) {
  const dayWidth = timelineWidth / totalDays;

  // Build month spans
  const months: { label: string; startDay: number; span: number }[] = [];
  let curMonth = -1;
  let curYear = -1;

  for (let i = 0; i < totalDays; i++) {
    const d = new Date(minDate.getTime() + i * DAY_MS);
    const m = d.getUTCMonth();
    const y = d.getUTCFullYear();
    if (m !== curMonth || y !== curYear) {
      months.push({ label: `${MONTH_NAMES[m]} ${y}`, startDay: i, span: 1 });
      curMonth = m;
      curYear = y;
    } else {
      months[months.length - 1].span++;
    }
  }

  // Build week spans — every Monday starts a new week
  const weeks: { label: string; startDay: number; span: number }[] = [];
  let weekStart = 0;

  for (let i = 0; i < totalDays; i++) {
    const d = new Date(minDate.getTime() + i * DAY_MS);
    const isMonday = d.getUTCDay() === 1;

    if (isMonday && i > 0) {
      // Close previous week
      weeks.push({
        label: formatWeekLabel(new Date(minDate.getTime() + weekStart * DAY_MS)),
        startDay: weekStart,
        span: i - weekStart,
      });
      weekStart = i;
    }
  }
  // Close final week
  if (weekStart < totalDays) {
    weeks.push({
      label: formatWeekLabel(new Date(minDate.getTime() + weekStart * DAY_MS)),
      startDay: weekStart,
      span: totalDays - weekStart,
    });
  }

  return (
    <div style={{ marginLeft: labelWidth, width: timelineWidth, position: "relative" }}>
      {/* Month row */}
      <div style={{ display: "flex", height: MONTH_HEADER_HEIGHT, borderBottom: "1px solid var(--border)" }}>
        {months.map((m, idx) => (
          <div
            key={idx}
            style={{
              width: m.span * dayWidth,
              fontSize: "12px",
              fontWeight: 600,
              color: "var(--text-primary)",
              paddingLeft: "8px",
              display: "flex",
              alignItems: "center",
              borderLeft: idx > 0 ? "2px solid var(--border)" : "none",
              background: idx % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)",
              overflow: "hidden",
              whiteSpace: "nowrap",
            }}
          >
            {m.span * dayWidth > 40 ? m.label : ""}
          </div>
        ))}
      </div>
      {/* Week row */}
      <div style={{ display: "flex", height: WEEK_HEADER_HEIGHT, borderBottom: "1px solid var(--border)" }}>
        {weeks.map((w, idx) => (
          <div
            key={idx}
            style={{
              width: w.span * dayWidth,
              fontSize: "11px",
              fontWeight: 400,
              color: "var(--text-secondary)",
              paddingLeft: "6px",
              display: "flex",
              alignItems: "center",
              borderLeft: "1px solid var(--border-subtle, var(--border))",
              overflow: "hidden",
              whiteSpace: "nowrap",
            }}
          >
            {w.span * dayWidth > 32 ? w.label : ""}
          </div>
        ))}
      </div>
    </div>
  );
}
