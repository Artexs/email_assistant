# s4-drafts-approvals-delegation — Stage 6

Part of [`../s4-drafts-approvals-delegation.md`](../s4-drafts-approvals-delegation.md). Read that file's "Input" and "Rules for every step" first.

## Stage 6 — Mail: `locateByActionId`; the own-mail skip wired into the sync [risky]

Checkpoint 1 input: stage 1 settled whether a FETCH of an appended draft returns the `x-ea-action-id` header at Interia (`draft.headerFetched`) and whether `SEARCH SINCE` works in Drafts and Sent. If `headerFetched` was false, the main session changes 6.1 before the build: the match uses the ENVELOPE `Message-ID` (`outgoingMessageId(actionId, address)`) instead of the header. If `searchSinceFound` was false, 6.1 gets the fallback `search({ all: true })` limited to the newest 500 UIDs.

- [ ] **6.1 `locateByActionId` (D14)**
  - Goal: the system finds its own draft or Sent copy in a folder without a header search, by the action id in the fetched header, with the APPEND uid as a hint.
  - Files: change `apps/server/src/modules/mail/locate.ts` (S3 stage 5), `locate.test.ts`, `mail/index.ts`.
  - Interfaces:

    ```ts
    export interface ActionLocateKey {
      actionId: string; // the X-EA-Action-Id value = the draft action id
      hintUid: number | null; // provider_result.uid of the APPEND, when known
      since: Date; // the draft's created_at: the search window starts one day earlier
    }
    export async function locateByActionId(
      provider: MailProvider,
      folder: string,
      key: ActionLocateKey
    ): Promise<FolderMessageMeta | null>;
    export const LOCATE_NEWEST_FIRST_CHUNK = 100;
    ```

  - Decisions:
    - A meta counts when `meta.actionId === key.actionId` (exact, the header value as the mapper cleans it) and it is not `\Deleted` (`isDeleted`, S3). (1) `hintUid` not null → `fetchMetaIn(folder, hintUid)`; counts → return it; (2) `searchSinceIn(folder, since − 1 day)` → `[]` → null; (3) `fetchByUidsIn` in chunks of 100, **newest UIDs first** (the draft is the youngest mail of the folder in the normal case); the first counted meta wins; (4) null. The folder may not exist (`fetchMetaIn` and `searchSinceIn` give null / `[]` for a missing folder, S3 stage 3): then null, no throw.
    - Nothing writes. One connection, the S3 `withMailbox` locks.
  - Test (`locate.test.ts`, the S3 fake): hint hit → one `fetchMetaIn` call, no search; hint miss (another message at that uid) → the search path finds it by the header; two drafts of two actions in the folder → each locate returns its own; the only copy has `\Deleted` → null; a missing folder → null; 250 messages with the wanted one at the lowest uid → three chunk fetches, newest first (`fake.calls` shows `fetchByUidsIn` three times); a header with another case on the stored message (`x-ea-action-id`) still matches (the fake's `findHeader` is case-insensitive, as the IMAP fetch).
  - Check: `bun run lint && bun run typecheck && bun run test:unit`.
  - Done when: the tests pass.
  - Out of scope: callers (stages 11, 12).

- [ ] **6.2 Own-mail skip: `actions.isOwnActionId` wired into the sync (D15)**
  - Goal: a mail that carries the `X-EA-Action-Id` of a real draft of this mailbox is never stored or triaged (architecture §6.1 "which mail is new"); the stub in `main.ts` goes away.
  - Files: change `apps/server/src/modules/actions/repo.ts`, `actions/index.ts`, `apps/server/src/main.ts`, `apps/server/src/scripts/mailbox-backfill.ts`, `apps/server/src/scripts/mailbox-rescan.ts` (both pass the real function to the tools in place of `async () => false`; `mail/tools.ts` keeps its parameter), `apps/server/test/integration/actions-repo.test.ts`, `apps/server/test/integration/mail-sync.test.ts`.
  - Interfaces:

    ```ts
    // actions/repo.ts
    export async function isOwnActionId(db, ctx: TenantContext, mailboxId: string, actionId: string): Promise<boolean>;
    // true when actionId is a uuid and an actions row with that id, type in ('create_draft', 'send'), exists for an email of this mailbox and org
    ```

  - Decisions:
    - A value that is not a uuid (`z.uuid()`) returns false without a query (any sender can write the header). The query joins `emails` on `(email_id, org_id)` and filters `emails.mailbox_id`: a draft id of another mailbox or organization is not "own" for this mailbox (the mail would be a real forward of our own mail into another account: stored and triaged like any mail).
    - `main.ts`: `createMailSyncJob({ …, isOwnActionId: (ctx, mailboxId, id) => isOwnActionId(db, ctx, mailboxId, id) })`. The sync counts the skip in `SyncResult.skippedOwn` (exists) and logs the count only.
    - Why a draft id (not the send's): the header on the wire is the draft action id (D8); the send row has `depends_on_action_id` = the draft; both types are accepted by the query so that a later change of the header owner needs no migration.
  - Test: `actions-repo.test.ts`: (1) a `create_draft` row of a mail of mailbox A → `isOwnActionId(…, A, id)` true; mailbox B of the same org → false; org B's ctx → false; a `move` row's id → false; `"not-a-uuid"` → false; a random uuid → false. `mail-sync.test.ts`: (2) the fake delivers a mail with `X-EA-Action-Id` = the id of a `create_draft` row of this mailbox → `syncMailbox` stores nothing for it, `skippedOwn` 1, the cursor moves past it; a mail with a random uuid in the header → stored; (3) the backfill (`backfillInbox`) with the same dependency skips it too.
  - Check: `bun run dev:up && bun run db:migrate && bun run lint && bun run typecheck && bun run test:unit && bun run test:int`. Manual: `bun run dev` starts without the stub (grep `isOwnActionId: async () => false` in `apps/server/src` prints nothing).
  - Done when: the tests pass and the stub is gone.
  - Out of scope: the own mail that Interia returns to INBOX before stage 6 exists on the VPS (stage 22 cleans one row by hand if needed).
