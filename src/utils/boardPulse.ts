/** IDs present in `current` but not in `known`. Used to flag brand-new cards. */
export function newlyAppearedIds(known: Set<string>, current: { id: string }[]): Set<string> {
  const out = new Set<string>();
  for (const item of current) {
    if (!known.has(item.id)) out.add(item.id);
  }
  return out;
}
