// The one result line of `bun run credentials:check`. `deploy/restore.sh` reads it (`credentials ok=<n> failed=<m>`, after the
// `[credentials-check] ` prefix of createCliOutput); change both together. A test pins them to each other.
export function credentialsLine(counts: { ok: number; failed: number }): string {
  return `credentials ok=${counts.ok} failed=${counts.failed}`;
}
