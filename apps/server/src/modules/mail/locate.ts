import type { FolderMessageMeta, MailProvider } from "./port";
import { isDeleted, type MailIdentity, sameMailIdentity } from "./sync-rules";

export const LOCATE_CHUNK = 100;

const DAY_MS = 86_400_000;

export interface LocateKey extends MailIdentity {
  /** The UID the row holds for this folder, when known. */
  hintUid: number | null;
}

/** The columns of a stored `emails` row that identify its mail. */
export interface LocateRow {
  message_id_header: string | null;
  content_hash: string;
  from_address: string | null;
  received_at: Date;
}

export function locateKeyOf(row: LocateRow, hintUid: number | null): LocateKey {
  return {
    messageId: row.message_id_header,
    contentHash: row.content_hash,
    from: row.from_address,
    receivedAt: row.received_at,
    hintUid,
  };
}

/**
 * Finds a known mail in `folder` by identity, without a header search (Interia has none that works).
 * `excludeUids` = UIDs that other rows of the same identity hold there: they are never this row's copy.
 * Nothing here writes to the mailbox.
 */
export async function locateMessage(
  provider: MailProvider,
  folder: string,
  key: LocateKey,
  opts: { excludeUids?: ReadonlySet<number> } = {}
): Promise<FolderMessageMeta | null> {
  const excluded = opts.excludeUids ?? new Set<number>();
  const counts = (meta: FolderMessageMeta): boolean =>
    !isDeleted(meta) && !excluded.has(meta.uid) && sameMailIdentity(meta, key);

  if (key.hintUid !== null && !excluded.has(key.hintUid)) {
    const hinted = await provider.fetchMetaIn(folder, key.hintUid);
    if (hinted !== null && counts(hinted)) return hinted;
  }

  // SINCE compares dates in the server's timezone: start one day early.
  const uids = await provider.searchSinceIn(folder, new Date(key.receivedAt.getTime() - DAY_MS));
  const candidates = uids.filter((uid) => !excluded.has(uid)).sort((a, b) => a - b);
  for (let i = 0; i < candidates.length; i += LOCATE_CHUNK) {
    const metas = await provider.fetchByUidsIn(folder, candidates.slice(i, i + LOCATE_CHUNK));
    const found = metas.find(counts);
    if (found !== undefined) return found;
  }
  return null;
}

export const LOCATE_NEWEST_FIRST_CHUNK = 100;

export interface ActionLocateKey {
  /** The X-EA-Action-Id value = the draft action id. */
  actionId: string;
  /** provider_result.uid of the APPEND, when known. */
  hintUid: number | null;
  /** The draft's created_at: the search window starts one day earlier. */
  since: Date;
}

/**
 * Finds the system's own draft or Sent copy in `folder` by the action id in the fetched header
 * (Interia finds no header by SEARCH, but a FETCH returns it). Nothing here writes to the mailbox.
 */
export async function locateByActionId(
  provider: MailProvider,
  folder: string,
  key: ActionLocateKey
): Promise<FolderMessageMeta | null> {
  const counts = (meta: FolderMessageMeta): boolean => !isDeleted(meta) && meta.actionId === key.actionId;

  if (key.hintUid !== null) {
    const hinted = await provider.fetchMetaIn(folder, key.hintUid);
    if (hinted !== null && counts(hinted)) return hinted;
  }

  // SINCE compares dates in the server's timezone: start one day early.
  const uids = await provider.searchSinceIn(folder, new Date(key.since.getTime() - DAY_MS));
  const newestFirst = [...uids].sort((a, b) => b - a);
  for (let i = 0; i < newestFirst.length; i += LOCATE_NEWEST_FIRST_CHUNK) {
    const metas = await provider.fetchByUidsIn(folder, newestFirst.slice(i, i + LOCATE_NEWEST_FIRST_CHUNK));
    const found = metas.find(counts);
    if (found !== undefined) return found;
  }
  return null;
}
