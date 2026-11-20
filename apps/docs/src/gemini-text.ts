// The rule for Gemini text on a public page (coordinator amendment 2026-11-20): Gemini stays in the code as an optional provider,
// off by default. A page names only the providers that run by default. A block of a page that names Gemini must say
// "optional, off by default"; no page says that Gemini is removed.
const decode = (text: string): string =>
  text
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

// The visible text of each block that can hold a sentence: a table row, a list item or a paragraph.
export function blocksWithText(source: string): string[] {
  return [...source.matchAll(/<(tr|li|p)\b[\s\S]*?<\/\1>/g)].map((match) =>
    decode(match[0].replace(/<[^>]*>/g, " "))
      .replace(/\s+/g, " ")
      .trim()
  );
}

// A block that names Gemini must say that it is optional and off by default.
export function geminiOutsideCondition(blocks: readonly string[]): string[] {
  return blocks.filter((block) => /gemini/i.test(block) && !/optional, off by default/i.test(block));
}

// A page that says that Gemini is removed, or that OpenAI is the only provider of the code, claims what the code does not do.
export function geminiClaimProblems(text: string): string[] {
  return [/gemini[^.]{0,40}\b(removed|dropped|gone)\b/i, /\bonly\s+openai\b/i, /\bopenai\s+only\b/i]
    .filter((pattern) => pattern.test(text))
    .map((pattern) => String(pattern));
}
