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
      reporter: ["text-summary", "lcov"],
      reportsDirectory: "coverage",
      include: [
        "src/**/*.{ts,tsx}",
        "server/**/*.ts",
        "cli/**/*.ts",
        "shared/**/*.ts",
        "mcp/**/*.ts",
      ],
      exclude: ["**/*.d.ts", "**/*.test.ts", "**/*.test.tsx"],
    },
  },
});
