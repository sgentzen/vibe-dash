/**
 * Compute the next due date for a recurring task.
 * Supports: daily, weekly, monthly, or simple cron-like expressions.
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
      base.setUTCMonth(base.getUTCMonth() + 1);
      break;
    }
    case "yearly": {
      base.setUTCFullYear(base.getUTCFullYear() + 1);
      break;
    }
    default: {
      // Try parsing "every Nd" / "every Nw" / "every Nm"
      const match = lowerRule.match(/^every\s+(\d+)\s*([dwm])$/);
      if (match) {
        const n = parseInt(match[1], 10);
        const unit = match[2];
        if (unit === "d") base.setUTCDate(base.getUTCDate() + n);
        else if (unit === "w") base.setUTCDate(base.getUTCDate() + n * 7);
        else if (unit === "m") base.setUTCMonth(base.getUTCMonth() + n);
      } else {
        // Fallback: treat as daily
        base.setUTCDate(base.getUTCDate() + 1);
      }
      break;
    }
  }

  return base.toISOString().slice(0, 10);
}
