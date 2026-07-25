/** True when the user has requested reduced motion. SSR/jsdom-safe. */
export function prefersReducedMotion(): boolean {
  return typeof globalThis.window !== "undefined"
    && typeof globalThis.matchMedia === "function"
    && globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
