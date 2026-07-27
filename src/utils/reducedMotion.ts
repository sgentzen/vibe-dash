/** True when the user has requested reduced motion. SSR/jsdom-safe. */
export function prefersReducedMotion(): boolean {
  return globalThis.window !== undefined
    && typeof globalThis.matchMedia === "function"
    && globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
