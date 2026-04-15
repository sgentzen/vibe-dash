export {};

// Polyfill matchMedia for jsdom (not implemented natively)
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

// Load jest-dom matchers when running in jsdom environment
if (typeof document !== "undefined") {
  await import("@testing-library/jest-dom/vitest");
}
