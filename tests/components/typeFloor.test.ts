import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e)) out.push(p);
  }
  return out;
}

// A fontSize/iconSize value expression assigned a sub-11px token — covers the
// direct-literal form (`fontSize: "10px"`) AND ternary/computed forms
// (`fontSize: cond ? "10px" : "11px"`, `const fontSize = size ? "12px" : "10px"`).
// `[^,;}\n]*` stops the scan at the property boundary so a legit `marginBottom:
// "10px"` on the same line as `fontSize: "12px"` is NOT flagged.
const SUB_11_FONT = /font[Ss]ize\s*[:=]\s*[^,;}\n]*["'](9|10)px["']/;
// `font:` shorthand carrying a sub-11px size.
const SUB_11_SHORTHAND = /\b(9|10)px\b[^;]*sans-serif/;

describe("11px type floor", () => {
  it("no source file sets a sub-11px font size", () => {
    const offenders: string[] = [];
    for (const f of walk("src")) {
      const src = readFileSync(f, "utf8");
      if (SUB_11_FONT.test(src) || SUB_11_SHORTHAND.test(src)) {
        offenders.push(f);
      }
    }
    expect(offenders, `sub-11px font sizes found in:\n${offenders.join("\n")}`).toEqual([]);
  });
});
