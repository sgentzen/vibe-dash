/**
 * Timestamp values that are not the ISO instant `now()` writes, shared by the
 * tests that pin the shape check on agent columns.
 *
 * Each entry is a value `julianday()` and/or `new Date()` will read, and that
 * the two readers either place differently or re-evaluate on every pass. See
 * the ISO_INSTANT doc comment in server/db/agents.ts for why the guard is an
 * exact match for the writer rather than a survey of what the parsers accept.
 */
const zoned = () => new Date().toISOString();

export const NON_INSTANT_SHAPES: [name: string, value: string][] = [
  ["the literal string 'now'", "now"],
  ["a bare date with no time", "2099-01-01"],
  ["a bare time with no date", "12:00"],
  ["a date-time naming no zone", zoned().replace(/\.\d+Z$/, "")],
  ["a space in place of the T", zoned().replace("T", " ").replace(/\.\d+Z$/, "")],
  ["a numeric UTC offset", "2026-09-18T23:00:00+05:00"],
  ["seconds but no milliseconds", zoned().replace(/\.\d+Z$/, "Z")],
  // A well-formed instant, a NUL, then anything at all. SQLite's string
  // functions stop at the NUL and pronounce the row well-formed; ECMAScript
  // sees the whole string and rejects it.
  ["a NUL byte hiding a trailing garbage suffix", `${zoned()}\0not-a-timestamp`],
];
