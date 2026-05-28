import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "../utils/reducedMotion.js";

/**
 * Returns true for ~`durationMs` after `value` changes — never on first mount.
 * No-ops (stays false) when the user prefers reduced motion.
 */
export function usePulseOnChange<T>(value: T, durationMs = 800): boolean {
  const prev = useRef<T | undefined>(undefined);
  const initialized = useRef(false);
  const [pulsing, setPulsing] = useState(false);

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      prev.current = value;
      return;
    }
    if (Object.is(prev.current, value)) return;
    prev.current = value;
    if (prefersReducedMotion()) return;
    setPulsing(true);
    const t = setTimeout(() => setPulsing(false), durationMs);
    return () => clearTimeout(t);
  }, [value, durationMs]);

  return pulsing;
}
