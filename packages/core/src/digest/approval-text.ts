export const FIELD_MAX_CHARS = 80;
const LONE_HIGH_SURROGATE = /[\ud800-\udbff]$/;

export function cutEnd(text: string, max: number): string {
  const head = text.slice(0, Math.max(0, max));
  return head.replace(LONE_HIGH_SURROGATE, "");
}
