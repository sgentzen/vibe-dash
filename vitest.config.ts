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
      // lcov for CI upload; text/html for local inspection.
      reporter: ["text-summary", "lcov", "html"],
      reportsDirectory: "coverage",
      include: ["server/**", "shared/**", "src/**"],
      exclude: ["**/*.test.ts", "**/*.test.tsx", "tests/**", "e2e/**"],
      // A ratchet, not a target. These sit a couple of points under the measured
      // values so ordinary churn doesn't fail the build, while a real drop does.
      // Measured 2026-08-10 with the plugin subsystem removed (#171):
      //   statements 52.12  branches 48.66  functions 51.26  lines 54.63
      // Raise these as coverage improves; do not lower them to make a build pass.
      thresholds: {
        statements: 50,
        branches: 46,
        functions: 49,
        lines: 52,
      },
    },
  },
});
