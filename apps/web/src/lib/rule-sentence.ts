export type RuleSlot = "pattern" | "kind" | "scope";
export type SentencePart = { kind: "text"; text: string } | { kind: "slot"; slot: RuleSlot };

const SLOTS: readonly RuleSlot[] = ["pattern", "kind", "scope"];
const SLOT_PATTERN = /\{(\w+)\}/g;

function isSlot(name: string): name is RuleSlot {
  return (SLOTS as readonly string[]).includes(name);
}

// Splits the sentence text of a language into plain text and the three slots of the add-rule form, in the order of that language.
// Each slot must appear once. A missing, repeated or unknown slot throws: it is an error of the text, not of the user.
export function sentenceParts(template: string): SentencePart[] {
  const parts: SentencePart[] = [];
  const seen = new Set<RuleSlot>();
  let from = 0;
  const pushText = (text: string) => {
    if (text !== "") parts.push({ kind: "text", text });
  };
  for (const match of template.matchAll(SLOT_PATTERN)) {
    const name = match[1] ?? "";
    if (!isSlot(name)) throw new Error(`Unknown slot {${name}} in the rule sentence`);
    if (seen.has(name)) throw new Error(`Slot {${name}} repeats in the rule sentence`);
    seen.add(name);
    pushText(template.slice(from, match.index));
    parts.push({ kind: "slot", slot: name });
    from = match.index + match[0].length;
  }
  pushText(template.slice(from));
  const missing = SLOTS.filter((slot) => !seen.has(slot));
  if (missing.length > 0) throw new Error(`Slot {${missing[0]}} is missing in the rule sentence`);
  return parts;
}
