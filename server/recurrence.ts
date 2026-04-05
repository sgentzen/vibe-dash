/**
 * Add N months to a date, clamping to the last day of the target month
 * to avoid overflow (e.g. Jan 31 + 1 month → Feb 28, not Mar 3).
 */
function addMonths(date: Date, n: number): void {
  const day = date.getUTCDate();
  date.setUTCDate(1); // prevent overflow during month change
  date.setUTCMonth(date.getUTCMonth() + n);
  // Clamp to last day of resulting month
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
}

/**
 * Compute the next due date for a recurring task.
 * Supports: daily, weekly, monthly, yearly, or "every Nd/w/m" expressions.
 */
export function getNextDueDate(currentDueDate: string | null, rule: string): string {
  const base = currentDueDate ? new Date(currentDueDate) : new Date();
  const lowerRule = rule.toLowerCase().trim();

  switch (lowerRule) {
    case "daily": {
      base.setUTCDate(base.getUTCDate() + 1);
      break;
    }
    case "weekly": {
      base.setUTCDate(base.getUTCDate() + 7);
      break;
    }
    case "monthly": {
      addMonths(base, 1);
      break;
    }
    case "yearly": {
      addMonths(base, 12);
      break;
    }
    default: {
      const match = lowerRule.match(/^every\s+(\d+)\s*([dwm])$/);
      if (match) {
        const n = parseInt(match[1], 10);
        const unit = match[2];
        if (unit === "d") base.setUTCDate(base.getUTCDate() + n);
        else if (unit === "w") base.setUTCDate(base.getUTCDate() + n * 7);
        else if (unit === "m") addMonths(base, n);
      } else {
        // Fallback: treat as daily
        base.setUTCDate(base.getUTCDate() + 1);
      }
      break;
    }
  }

  return base.toISOString().slice(0, 10);
}
