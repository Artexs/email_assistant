export interface InboxKey {
  messageId: string | null;
  hash: string;
}

export interface AuditCounts {
  inbox: number;
  stored: number;
  missing: number;
  duplicates: number;
}

function countKeys(keys: InboxKey[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const key of keys) {
    const id = JSON.stringify([key.messageId, key.hash]);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/** Compares the INBOX with the stored rows per `(messageId, hash)`. Pure. */
export function compareInboxWithDb(inbox: InboxKey[], rows: InboxKey[]): AuditCounts {
  const inboxCounts = countKeys(inbox);
  const storedCounts = countKeys(rows);
  let missing = 0;
  let duplicates = 0;
  for (const [id, count] of inboxCounts) missing += Math.max(0, count - (storedCounts.get(id) ?? 0));
  for (const [id, count] of storedCounts) duplicates += Math.max(0, count - (inboxCounts.get(id) ?? 0));
  return { inbox: inbox.length, stored: rows.length, missing, duplicates };
}
