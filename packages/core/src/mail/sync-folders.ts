export const syncFolderRoles = ["inbox", "sort", "junk"] as const;
export type SyncFolderRole = (typeof syncFolderRoles)[number];

export const syncFolderKeys = ["inbox", "offers", "social", "bills", "junk"] as const;
export type SyncFolderKey = (typeof syncFolderKeys)[number];

export interface SyncFolderDefault {
  key: Exclude<SyncFolderKey, "inbox">;
  path: string;
  role: Exclude<SyncFolderRole, "inbox">;
}

// Interia names (notes/2026-11-03-interia-imap-capabilities.md). The order is the sync order after INBOX.
export const SYNC_FOLDER_DEFAULTS: readonly SyncFolderDefault[] = [
  { key: "offers", path: "Oferty", role: "sort" },
  { key: "social", path: "Społeczności", role: "sort" },
  { key: "bills", path: "Rachunki", role: "sort" },
  { key: "junk", path: "Wiadomości-śmieci", role: "junk" },
];

export function syncFolderDefaultPath(key: SyncFolderDefault["key"]): string {
  const folder = SYNC_FOLDER_DEFAULTS.find((item) => item.key === key);
  if (folder === undefined) throw new Error(`no sync folder default for ${key}`);
  return folder.path;
}

// The root of the app's own folders (the first part of AI_FOLDER_NAMES.ai_info).
export const AI_FOLDER_ROOT = "AI";

/** Picks the default folders that the server lists, never a reserved folder or one inside the app's own folders. */
export function pickSyncFolders(input: {
  listed: readonly { path: string; delimiter: string }[];
  reservedPaths: readonly string[]; // folder_map values of drafts, sent, trash and the ai_* keys
  defaults?: readonly SyncFolderDefault[]; // tests only
}): SyncFolderDefault[] {
  const reserved = new Set(input.reservedPaths);
  const picked: SyncFolderDefault[] = [];
  for (const folder of input.defaults ?? SYNC_FOLDER_DEFAULTS) {
    if (picked.some((item) => item.key === folder.key)) continue;
    const entry = input.listed.find(
      (listed) =>
        listed.path === folder.path &&
        !reserved.has(listed.path) &&
        listed.path !== AI_FOLDER_ROOT &&
        !listed.path.startsWith(`${AI_FOLDER_ROOT}${listed.delimiter}`)
    );
    if (entry !== undefined) picked.push(folder);
  }
  return picked;
}
