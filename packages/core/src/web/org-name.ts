// The typed organization name of the delete dialog matches after trim, ignoring case. Empty typed text never matches.
// The server (`deleteOrganization`) and the dialog use this one rule.
export function orgNameMatches(name: string, typed: string): boolean {
  const wanted = typed.trim();
  if (wanted === "") return false;
  return name.trim().toLowerCase() === wanted.toLowerCase();
}
