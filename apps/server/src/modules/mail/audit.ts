export interface InboxKey {
  messageId: string | null;
  hash: string;
}

export interface AuditCounts {
  mail: number;
  stored: number;
  missing: number;
  duplicates: number;
  // Mail with no row in this folder but a row in another enabled synced folder (moved or sorted since): not lost.
  cross: number;
}

function countKeys(keys: InboxKey[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const key of keys) {
    const id = JSON.stringify([key.messageId, key.hash]);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/**
 * Compares the mail of one folder with the stored rows per `(messageId, hash)`. `rowsElsewhere` are the rows of the other enabled synced folders:
 * a mail without a row here but with one there counts as `cross`, not `missing`. Pure.
 */
export function compareFolderWithDb(mail: InboxKey[], rowsHere: InboxKey[], rowsElsewhere: InboxKey[]): AuditCounts {
  const mailCounts = countKeys(mail);
  const storedCounts = countKeys(rowsHere);
  const elsewhereCounts = countKeys(rowsElsewhere);
  let missing = 0;
  let duplicates = 0;
  let cross = 0;
  for (const [id, count] of mailCounts) {
    const short = Math.max(0, count - (storedCounts.get(id) ?? 0));
    const found = Math.min(short, elsewhereCounts.get(id) ?? 0);
    cross += found;
    missing += short - found;
  }
  for (const [id, count] of storedCounts) duplicates += Math.max(0, count - (mailCounts.get(id) ?? 0));
  return { mail: mail.length, stored: rowsHere.length, missing, duplicates, cross };
}

/** The old INBOX-only compare (no other folders). */
export function compareInboxWithDb(inbox: InboxKey[], rows: InboxKey[]): AuditCounts {
  return compareFolderWithDb(inbox, rows, []);
}

/** Exit code of `mailbox:audit`: from the INBOX counts only; `cross` never changes it. No INBOX counts (the server does not list it) is an error: 1. */
export function auditExitCode(counts: AuditCounts | null | undefined): 0 | 1 | 2 {
  if (counts === null || counts === undefined) return 1;
  return counts.missing > 0 || counts.duplicates > 0 ? 2 : 0;
}
