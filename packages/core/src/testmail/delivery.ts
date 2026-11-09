import { SYNC_FOLDER_DEFAULTS } from "../mail/sync-folders";

export const sortFolderKeys = ["offers", "social", "bills", "junk"] as const;
export type SortFolderKey = (typeof sortFolderKeys)[number];

const defaultPath = (key: SortFolderKey): string => {
  const folder = SYNC_FOLDER_DEFAULTS.find((item) => item.key === key);
  if (folder === undefined) throw new Error(`no sync folder default for ${key}`);
  return folder.path;
};

// junk: the Interia spam folder, found by its default name
export const SORT_FOLDER_NAMES: Record<Exclude<SortFolderKey, "junk">, string> = {
  offers: defaultPath("offers"),
  social: defaultPath("social"),
  bills: defaultPath("bills"),
};

export interface FoundCopy {
  folder: "inbox" | SortFolderKey;
  uid: number;
  messageId: string | null;
  from: string | null;
}

export type DeliveryOp =
  | { op: "move"; folder: SortFolderKey; uid: number }
  | { op: "delete"; folder: SortFolderKey; uid: number };

export const deliveryResults = ["synced", "in_inbox", "moved", "duplicate_removed", "not_found"] as const;

export interface CaseDelivery {
  caseId: string;
  result: (typeof deliveryResults)[number];
  folder: "db" | "inbox" | SortFolderKey | null; // where the tool found it (null for not_found)
  ops: DeliveryOp[];
}

interface SortCopy {
  folder: SortFolderKey;
  uid: number;
}

function sortOrder(a: SortCopy, b: SortCopy): number {
  return sortFolderKeys.indexOf(a.folder) - sortFolderKeys.indexOf(b.folder) || a.uid - b.uid;
}

const deleteOf = (copy: SortCopy): DeliveryOp => ({ op: "delete", folder: copy.folder, uid: copy.uid });

// A later case with an already planned message id is `not_found` without ops: two cases must never act on the same copies.
export function planDelivery(input: {
  wanted: { caseId: string; messageId: string }[];
  sender: string; // the persona inbox address
  syncedMessageIds: ReadonlySet<string>;
  found: readonly FoundCopy[];
}): CaseDelivery[] {
  const sender = input.sender.trim().toLowerCase();
  const ours = input.found.filter((copy) => copy.messageId !== null && copy.from?.trim().toLowerCase() === sender);

  const planned = new Set<string>();
  return input.wanted.map(({ caseId, messageId }) => {
    const id = messageId.trim();
    if (planned.has(id)) return { caseId, result: "not_found", folder: null, ops: [] };
    planned.add(id);
    const copies = ours.filter((copy) => copy.messageId?.trim() === id);
    const inInbox = copies.some((copy) => copy.folder === "inbox");
    const sortCopies: SortCopy[] = [];
    for (const copy of copies) {
      if (copy.folder !== "inbox") sortCopies.push({ folder: copy.folder, uid: copy.uid });
    }
    sortCopies.sort(sortOrder);

    if (input.syncedMessageIds.has(id)) {
      // A sort-folder copy without an INBOX copy can be the only one: leave it.
      return { caseId, result: "synced", folder: "db", ops: inInbox ? sortCopies.map(deleteOf) : [] };
    }
    const first = sortCopies[0];
    if (first === undefined) {
      return inInbox
        ? { caseId, result: "in_inbox", folder: "inbox", ops: [] }
        : { caseId, result: "not_found", folder: null, ops: [] };
    }
    if (inInbox) {
      return { caseId, result: "duplicate_removed", folder: first.folder, ops: sortCopies.map(deleteOf) };
    }
    const ops: DeliveryOp[] = [
      { op: "move", folder: first.folder, uid: first.uid },
      ...sortCopies.slice(1).map(deleteOf),
    ];
    return { caseId, result: "moved", folder: first.folder, ops };
  });
}
