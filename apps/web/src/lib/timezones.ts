const MAX_RESULTS = 50;

export function filterTimeZones(list: readonly string[], query: string, current: string): string[] {
  const q = query.trim().toLowerCase().replaceAll(" ", "_");
  const matches = q === "" ? list : list.filter((name) => name.toLowerCase().includes(q));
  const currentMatches = q === "" || current.toLowerCase().includes(q);
  const result = currentMatches ? [current] : [];
  for (const name of matches) {
    if (result.length >= MAX_RESULTS) break;
    if (name !== current) result.push(name);
  }
  return result;
}
