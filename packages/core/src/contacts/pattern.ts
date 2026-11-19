// The one rule for the text that a suggestion row may hold in `sender_suggestions.pattern` (an address or `@domain`). The table
// CHECK `sender_suggestions_pattern_check` refuses a longer or unclean text, and a refused INSERT would abort the whole profile
// pass of the mailbox, so the generator asks this function before it makes a candidate. This function is equal to the CHECK or
// stricter: it never accepts what the CHECK refuses (a test compares the two on a fixed set of probes). The CHECK says: lower
// case, 2 to 254 characters, no white space, no control character, no `<` and no `>`.
export const SUGGESTION_PATTERN_MAX_LENGTH = 254;
const SUGGESTION_PATTERN_MIN_LENGTH = 2;
// `\s` is wider than the database class `[[:space:]]`, `\p{C}` (control, format, unassigned, surrogate, private use) wider than `[[:cntrl:]]`.
const REFUSED_CHARACTER = /[\s\p{C}<>]/u;

export function isStorableSuggestionPattern(pattern: string): boolean {
  const length = [...pattern].length;
  if (length < SUGGESTION_PATTERN_MIN_LENGTH || length > SUGGESTION_PATTERN_MAX_LENGTH) return false;
  if (pattern !== pattern.toLowerCase()) return false;
  return !REFUSED_CHARACTER.test(pattern);
}
