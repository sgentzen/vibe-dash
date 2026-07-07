import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    environmentMatchGlobs: [
      // Component tests (.tsx) use jsdom; everything else uses node (default)
      ["tests/**/*.test.tsx", "jsdom"],
    ],
    setupFiles: ["tests/setup-dom.ts"],
    coverage: {
      provider: "v8",
      // lcov for CI upload; text/html for local inspection. Informational only —
      // no thresholds, so coverage never fails the build.
      reporter: ["text-summary", "lcov", "html"],
      reportsDirectory: "coverage",
      include: ["server/**", "shared/**", "src/**"],
      exclude: ["**/*.test.ts", "**/*.test.tsx", "tests/**", "e2e/**"],
    },
  },
});
