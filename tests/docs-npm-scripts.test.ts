import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Archived and planning docs describe the project as it was, so a script they
// name may rightly be gone. Everything else is instructions someone will follow.
const HISTORICAL_DIRS = new Set(["archive", "plans"]);

function markdownUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return HISTORICAL_DIRS.has(entry.name) ? [] : markdownUnder(full);
    return entry.name.endsWith(".md") ? [full] : [];
  });
}

describe("npm scripts named in the docs", () => {
  const scripts = (JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  }).scripts;
  const docs = [path.join(ROOT, "README.md"), path.join(ROOT, "CLAUDE.md"), ...markdownUnder(path.join(ROOT, "docs"))];

  const referenced = docs.flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(/npm run ([a-z][\w:-]*)/g)].map((m) => ({
      file: path.relative(ROOT, file),
      script: m[1],
    }))
  );

  it("finds some references, so the scan itself is not silently empty", () => {
    expect(referenced.length).toBeGreaterThan(0);
  });

  it("exist in package.json", () => {
    const missing = referenced.filter(({ script }) => !(script in scripts));
    expect(missing).toEqual([]);
  });

  it("keeps serve as the server-only start the service examples rely on", () => {
    expect(scripts.serve).toBe("tsx server/index.ts");
  });
});
