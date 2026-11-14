# F032 stage 01 — Copy rule and held rows

Part of [`../plan.md`](../plan.md). Lands on the worker's proof. Read D2, D3, D6. Stage 02 is the first caller.

## Step 1 — Pure rules in `mail/sync-rules.ts`

**Goal.** The copy decision, and the filter of metas that a row holds.

**Interfaces** (stage 02 uses these names; add fields, do not rename). `FolderRowAtUid` is a row type, so it lives in `mail/repo/copies.ts` next to `MovedRow` and `MoveCandidateRow` (step 2); `sync-rules.ts` imports it as a type, as it does those two.

```ts
/** A stored row at a UID of one folder (repo/copies.ts). */
export interface FolderRowAtUid {
  id: string;
  uid: number;
  message_id_header: string | null;
  content_hash: string;
  from_address: string | null;
  received_at: Date;
}

/** Metas whose UID a row of the same identity holds in the folder: that row's mail. Order of the rest is kept. */
export function dropHeldMetas<T extends MessageMeta>(
  metas: readonly T[],
  held: readonly FolderRowAtUid[],
  mode?: IdentityMode
): T[];

export type BelowCursorCopyDecision =
  | { kind: "store"; dedupKey: string }
  | { kind: "move_in_flight"; emailId: string }
  | { kind: "held"; emailId: string }
  | { kind: "cross_copy"; emailId: string };

export function decideBelowCursorCopy(input: {
  folder: string; // S
  uid: number; // the hit UID in S
  rowId: string; // the moved row, still in its system folder
  baseKey: string;
  /** Every copy of the identity: DB rows, copies planned earlier in this check, this run's stores (`run:` ids). */
  copies: readonly KnownCopy[];
  matched: ReadonlyMap<string, string>;
  now: Date;
}): BelowCursorCopyDecision;
```

**Decisions.** D2 (order), D3 (numbering), D6. `dropHeldMetas` compares by `sameMailIdentity` (default `IDENTITY_MODE`) with the row's identity fields, at an equal UID. `held` excludes the row `rowId` itself. `cross_copy` uses the same "matched in another folder than S" test as `decideIncoming` (reuse, do not copy, when a small helper fits).

**Test** (`apps/server/src/modules/mail/sync-rules.test.ts`; one `KnownCopy` builder; `NOW` = `2026-11-10T12:00:00Z`; S = `INBOX`, hit UID 10, row `r1`):

- 1.1 copies `[r1 in AI/Info, uid 40, key base]` → `{ store, base#2 }`.
- 1.2 copies r1, `r2` (`base#2`, `AI/Spam`, uid 41), `r3` (`base#3`, `Oferty`, uid 42) → `{ store, base#4 }`.
- 1.3 r2 with `movePendingAt` = NOW − 1 h → `{ move_in_flight, r2 }`; with NOW − 25 h → `store`.
- 1.4 r2 in `Oferty` with uid 10 → `{ held, r2 }`; r1 itself with uid 10 (only copy) → `store`.
- 1.5 `matched` = `{ r2 → "Oferty" }` → `{ cross_copy, r2 }`; `{ r2 → "INBOX" }` → `store`; a `run:base#2` copy matched to `Oferty` → `cross_copy` with that id.
- 1.6 r2 with a fresh marker and uid 10 → `move_in_flight` (order).
- 1.7 `dropHeldMetas`: metas at UIDs 10, 11, 12; held row at uid 11 with the identity of meta 11 → `[10, 12]`; held row at uid 11 with another Message-ID → `[10, 11, 12]`; held row at uid 13 → `[10, 11, 12]`; `held` empty → the same array order.

**Check.** `bun test apps/server/src/modules/mail/sync-rules.test.ts`

**Done when.** Cases 1.1–1.7 pass; the existing cases pass unchanged.

## Step 2 — `listFolderRowsAtUids` in `mail/repo/copies.ts`

**Goal.** One read per chunk of the check: the rows that hold one of the given UIDs in folder S.

**Interface** (export from `mail/repo/index.ts`):

```ts
export async function listFolderRowsAtUids(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  folder: string,
  uids: readonly number[]
): Promise<FolderRowAtUid[]>;
```

**Decisions.** Filters `org_id`, `mailbox_id`, `folder` = the given folder, `uid in uids`. `[]` without a query for an empty list . `uid` is `bigint`: map with `Number(...)` as the other reads of the file do. Any identity: the caller compares (D6).

**Test** (`apps/server/test/integration/mail-repo.test.ts`, near the `listFolderUids` / `listMoveCandidates` cases):

- 1.8 rows A (INBOX, uid 10), B (INBOX, uid 12), C (`Oferty`, uid 10); call with INBOX, `[10, 11]` → only A, with its six fields.
- 1.9 `[]` → `[]`.
- 1.10 Tenant: org B has a row in INBOX at uid 10 of its own mailbox; the call with org A's context and org B's mailbox id → `[]`.

**Check.** `bun test apps/server/test/integration/mail-repo.test.ts`

**Done when.** 1.8–1.10 pass. Then the Proof of `plan.md` with `NN` = `01` ends `PROOF_OK`.

**Out of scope.** Changes to `listFolderUids`, `findCopies` or `listRecentlyMoved`.
