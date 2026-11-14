// Both sides go to Unicode NFC first, so a typed "ż" in decomposed form (z + dot above) matches the stored "ż".
// The typed organization name of the delete dialog matches after trim, ignoring case. Empty typed text never matches.
// The server (`deleteOrganization`) and the dialog use this one rule.
export function orgNameMatches(name: string, typed: string): boolean {
  const wanted = typed.trim().normalize("NFC");
  if (wanted === "") return false;
  return name.trim().normalize("NFC").toLowerCase() === wanted.toLowerCase();
}
