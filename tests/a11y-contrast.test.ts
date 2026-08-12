import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Guards the contrast contract the palette in App.css is supposed to honour.
 *
 * This exists because `--text-muted` drifted under target twice. Both times the
 * ratio was checked by hand against `--bg-primary` and signed off, while the
 * micro text it governs actually renders on cards (`--bg-secondary`), which is
 * the darker pairing in the dark theme and the tighter one in both. Reading the
 * numbers off the real tokens is the only way that stays true: a comment next
 * to a hex value cannot fail when someone edits the hex value.
 *
 * Ratios are computed from the stylesheet rather than hard-coded, so changing a
 * token is allowed. What is not allowed is changing it below the bar.
 */

const CSS = readFileSync(
  fileURLToPath(new URL("../src/App.css", import.meta.url)),
  "utf8",
);

const SIX_DIGIT_HEX = /^#[0-9a-fA-F]{6}/;

/**
 * Pull one custom property out of a specific rule block.
 *
 * Scoped to the block because every token is declared twice, once per theme,
 * and a file-wide search would silently return whichever came first.
 *
 * Built from string operations rather than an interpolated RegExp so there is
 * no constructed-pattern to audit, and so a token name containing a regex
 * metacharacter could never quietly match the wrong declaration.
 */
function token(blockStart: string, name: string): string {
  const start = CSS.indexOf(blockStart);
  if (start === -1) throw new Error(`no ${blockStart} block in App.css`);
  const end = CSS.indexOf("\n}", start);
  if (end === -1) throw new Error(`${blockStart} block in App.css is unterminated`);

  for (const line of CSS.slice(start + blockStart.length, end).split("\n")) {
    const declaration = line.trim();
    // The colon makes this an exact match, so --bg-primary cannot be satisfied
    // by a longer token that merely starts with the same characters.
    if (!declaration.startsWith(`${name}:`)) continue;
    const value = declaration.slice(name.length + 1).trim();
    const hex = SIX_DIGIT_HEX.exec(value);
    if (!hex) throw new Error(`${name} in ${blockStart} is not a 6-digit hex: ${value}`);
    return hex[0];
  }
  throw new Error(`${name} not found in ${blockStart}`);
}

/** Relative luminance, WCAG 2.1 definition. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => {
    const srgb = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const THEMES = [
  { name: "dark", selector: ":root {" },
  { name: "light", selector: '[data-theme="light"] {' },
];

describe("App.css contrast contract", () => {
  // The internal bar, stricter than AA's 4.5:1, because --text-muted governs
  // 11px text. Recorded in docs/a11y-baseline.md.
  describe.each(THEMES)("$name theme", ({ selector }) => {
    it("--text-muted clears 7:1 on --bg-secondary, the card background", () => {
      const ratio = contrast(token(selector, "--text-muted"), token(selector, "--bg-secondary"));
      expect(ratio).toBeGreaterThanOrEqual(7);
    });

    it("--text-muted clears 7:1 on --bg-primary, the page background", () => {
      const ratio = contrast(token(selector, "--text-muted"), token(selector, "--bg-primary"));
      expect(ratio).toBeGreaterThanOrEqual(7);
    });

    // AA rather than the 7:1 above: --text-secondary is 12-14px body metadata,
    // not micro text. Note it is now the weakest text token in the palette, so
    // this is the floor most at risk of being crossed.
    //
    // --bg-tertiary is deliberately absent. That pairing is already failing in
    // the light theme at 4.42:1, a pre-existing WCAG 1.4.3 breach recorded in
    // docs/a11y-baseline.md and not introduced here. Asserting it would fail on
    // arrival, and lowering the threshold to accommodate it would turn a known
    // bug into a ratified one. The gap is tracked, not encoded.
    it("--text-secondary clears AA 4.5:1 on --bg-primary and --bg-secondary", () => {
      for (const bg of ["--bg-primary", "--bg-secondary"]) {
        const ratio = contrast(token(selector, "--text-secondary"), token(selector, bg));
        expect(ratio, `--text-secondary on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    });

    it("--text-primary clears AA 4.5:1 on every surface", () => {
      for (const bg of ["--bg-primary", "--bg-secondary", "--bg-tertiary"]) {
        const ratio = contrast(token(selector, "--text-primary"), token(selector, bg));
        expect(ratio, `--text-primary on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  });
});
