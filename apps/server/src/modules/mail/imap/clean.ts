// Postgres `text` rejects U+0000: one such mail would fail `insertEmail` on every run and block the cursor.
export function stripNul(value: string): string {
  return value.replaceAll("\u0000", "");
}

export function cleanOrNull(value: string | undefined): string | null {
  if (value === undefined) return null;
  const cleaned = stripNul(value).trim();
  return cleaned === "" ? null : cleaned;
}
