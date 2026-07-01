import tseslint from "typescript-eslint";
import sonarjs from "eslint-plugin-sonarjs";
import unicorn from "eslint-plugin-unicorn";
import jsxA11y from "eslint-plugin-jsx-a11y";
import unusedImports from "eslint-plugin-unused-imports";
import globals from "globals";

// Curated to mirror the SonarCloud rules reported for this project.
// Rules that Sonar can auto-remediate are set to "error" and fixed via `npm run lint:fix`.
// See docs/superpowers/plans/2026-07-01-sonarcloud-remediation.md for the rule -> Sonar mapping.
export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "coverage/**",
      "playwright-report/**",
      ".claude/**",
      ".claire/**",
      "e2e/**", // Playwright specs are outside the server/client tsconfig projects
      "**/*.config.js",
      "**/*.config.ts",
    ],
  },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [tseslint.configs.base],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.node },
    },
    plugins: { unicorn, "unused-imports": unusedImports, sonarjs },
    rules: {
      // --- unicorn: mechanical, autofixable ---
      "unicorn/prefer-node-protocol": "error", // S7772
      "unicorn/prefer-global-this": "error", // S7764
      "unicorn/prefer-number-properties": "error", // S7773
      "unicorn/prefer-single-call": "error", // S7778
      "unicorn/prefer-at": "error", // S7755
      "unicorn/no-zero-fractions": "error", // S7748
      "unicorn/no-negated-condition": "error", // S7735
      // --- unused imports: autofix removal (S1128) ---
      "unused-imports/no-unused-imports": "error",
      // --- type-aware @typescript-eslint: autofixable ---
      "@typescript-eslint/no-unnecessary-type-assertion": "error", // S4325
      "@typescript-eslint/prefer-optional-chain": "error", // S6582
      "@typescript-eslint/prefer-nullish-coalescing": [
        "warn",
        { ignoreConditionalTests: true, ignoreMixedLogicalExpressions: true },
      ], // S6606
      // --- sonarjs: report (manual refactor) ---
      "sonarjs/cognitive-complexity": ["warn", 15], // S3776
      "sonarjs/no-nested-conditional": "warn", // S3358
      "sonarjs/no-nested-template-literals": "warn", // S4624
      "sonarjs/no-identical-expressions": "warn", // S1764
      "sonarjs/no-dead-store": "warn", // S1854
    },
  },
  // Accessibility rules for the React client (S6819, S6848, S1082, S6847, ...)
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "jsx-a11y": jsxA11y },
    languageOptions: { globals: { ...globals.browser } },
    rules: { ...jsxA11y.flatConfigs.recommended.rules },
  },
);
