# test-mail-traffic — Stage 5

Part of [`../test-mail-traffic.md`](../test-mail-traffic.md). Read that file's "Facts checked" (Interia), "Design decisions" (D2, D4, D10) and "Rules for every step" first.

## Stage 5 — Deliver: move own test mail from the Interia sort folders into INBOX [risky]

Why risky: it changes a real mailbox (moves and deletes). Two guards must hold: the mailbox is `TEST_MAILBOX_ADDRESS`, and only the tool's own mails are touched.

- [ ] **5.1 Delivery plan (core) and `listEmailsByMessageIds` (mail repo)**
  - Goal: a pure plan of the IMAP operations per case, and a repository query for the mails that the DB already has.
  - Files: create `packages/core/src/testmail/delivery.ts`, `packages/core/src/testmail/delivery.test.ts`; change `packages/core/src/testmail/index.ts`,
    `apps/server/src/modules/mail/repo.ts`, `apps/server/src/modules/mail/index.ts`, `apps/server/test/integration/mail-repo.test.ts`.
  - Interfaces:

    ```ts
    // packages/core/src/testmail/delivery.ts
    export const sortFolderKeys = ["offers", "social", "bills", "junk"] as const;
    export type SortFolderKey = (typeof sortFolderKeys)[number];
    export const SORT_FOLDER_NAMES: Record<Exclude<SortFolderKey, "junk">, string> = {
      offers: "Oferty",
      social: "Społeczności",
      bills: "Rachunki",
    }; // junk: the \Junk special-use folder
    export interface FoundCopy {
      folder: "inbox" | SortFolderKey;
      uid: number;
      messageId: string | null;
      from: string | null;
    }
    export type DeliveryOp =
      | { op: "move"; folder: SortFolderKey; uid: number }
      | { op: "delete"; folder: SortFolderKey; uid: number };
    export interface CaseDelivery {
      caseId: string;
      result: "synced" | "in_inbox" | "moved" | "duplicate_removed" | "not_found";
      folder: "db" | "inbox" | SortFolderKey | null; // where the tool found it (null for not_found)
      ops: DeliveryOp[];
    }
    export function planDelivery(input: {
      wanted: { caseId: string; messageId: string }[];
      sender: string; // the persona inbox address
      syncedMessageIds: ReadonlySet<string>;
      found: readonly FoundCopy[];
    }): CaseDelivery[];

    // apps/server/src/modules/mail/repo.ts
    export async function listEmailsByMessageIds(
      db: DbOrTrx,
      ctx: TenantContext,
      mailboxId: string,
      messageIds: readonly string[]
    ): Promise<{ id: string; message_id_header: string; folder: string; status: string; in_reply_to: string | null }[]>;
    // [] for an empty list; chunks of 500 ids; the `in (…)` filter drops null ids, the mapping narrows message_id_header to string (filter `!== null`)
    ```

  - Decisions:
    - A copy counts only when its trimmed `messageId` equals a wanted id **and** `from` equals `sender` (case-insensitive, trimmed). Every other copy is ignored, so real mail is never touched.
    - Per wanted case: in `syncedMessageIds` → `synced`, folder `db`; ops = `delete` of every matching sort-folder copy (a leftover of a crash; the INBOX copy is
      never touched: the sync owns it).
      Else copies in INBOX and in sort folders → `duplicate_removed`, folder = the first sort folder (order `offers`, `social`, `bills`, `junk`), ops = `delete` of
      every sort-folder copy. Copies in INBOX only → `in_inbox`, no ops. Sort-folder copies only → `moved`, folder = the first one, ops = `move` of the copy with the
      lowest UID in that folder, then `delete` of every other sort-folder copy. No copy → `not_found`, folder null.
    - The output keeps the order of `wanted`.
    - `listEmailsByMessageIds` filters `org_id = ctx.orgId` and `mailbox_id`, `message_id_header in (…)`.
  - Test:
    1. (`delivery.test.ts`) one case per result kind: synced, in_inbox, moved (from offers), duplicate_removed (inbox + junk), not_found; a synced case with a leftover copy in `offers` → `synced` with one `delete offers`.
    2. A copy whose `messageId` is `" <x@y.test> "` matches the wanted `<x@y.test>`.
    3. A copy with the wanted id but another `from` → ignored (the case is `not_found`); a copy from the sender with an unknown id → ignored.
    4. Two copies in `offers` (uid 7 and 5) + one in `junk` → `move offers 5`, `delete offers 7`, `delete junk <uid>`.
    5. `from` `EA-TestMail-75WD@AgentMail.to ` matches sender `ea-testmail-75wd@agentmail.to`.
    6. (`mail-repo.test.ts`) `listEmailsByMessageIds` returns the rows of the two given ids of org A; the same id in org B's mailbox is not returned; `[]` input → `[]` without a query error.
  - Check: `bun run lint && bun run typecheck && bun run test:unit && bun run test:int`
  - Done when: tests 1–6 pass.
  - Out of scope: IMAP calls (5.2).

- [ ] **5.2 `deliverTestMail` (mail tools)**
  - Goal: the IMAP part: guard, find the copies, run the plan with the existing port methods.
  - Files: change `apps/server/src/modules/mail/tools.ts`, `apps/server/src/modules/mail/index.ts`, `apps/server/src/modules/mail/fake/index.ts` (new option
    `folderSpecialUse?: Record<string, string>`, e.g. `{ "Wiadomości-śmieci": "\\Junk" }`, used by `serverInfo()`; default none, so other tests do not change);
    create `apps/server/test/integration/mail-deliver.test.ts`.
  - Interfaces:

    ```ts
    export interface DeliverDeps extends ToolDeps {
      openProvider?: (imap: ImapConnectOptions) => Promise<MailProvider>;
    } // default openImapProvider
    export interface DeliverInput {
      testAddress: string | undefined;
      sender: string;
      wanted: { caseId: string; messageId: string; sentAt: Date }[]; // 1..200
      checkOnly: boolean; // plan and report, no move and no delete
    }
    export async function deliverTestMail(
      deps: DeliverDeps,
      ctx: TenantContext,
      mailboxId: string,
      input: DeliverInput
    ): Promise<CaseDelivery[]>;
    ```

  - Decisions:
    - Order: `getMailboxOrThrow` → `assertTestAddress(mailbox.address, input.testAddress)` (from `imap/probe-move.ts`; it throws `HardError`) → refuse when `sender`
      equals the mailbox address, does not end with `@agentmail.to`, or `wanted` is empty or longer than 200 (`HardError`) → `listEmailsByMessageIds` → only then `loadImapOptions` and `openProvider`.
      So a refusal opens no IMAP connection.
    - The IMAP connection is always opened (also when every wanted case is synced), so a leftover sort-folder copy of a synced mail is found and deleted (D10).
    - `since` = the earliest `sentAt` minus 1 day. Folders: INBOX; `Oferty`, `Społeczności`, `Rachunki` when `serverInfo().folders` lists them by exact path;
      the folder with `specialUse === "\\Junk"` as `junk`. For each: `searchSinceIn(path, since)` → `fetchByUidsIn(path, uids)` (INBOX through the same calls with `INBOX`)
      → `FoundCopy` with the folder key.
    - `checkOnly`: return the plan (results as planned, `ops` listed) and run no op.
    - Run the ops in plan order: `move` → `moveMessage(path, uid, INBOX)`; `delete` → `deleteMessage(path, uid)`. `MailNotFoundError` from `moveMessage` or `false`
      from `deleteMessage` (another run took it) → that case's result becomes `not_found` for this run (the next run sees `in_inbox` or `synced`); go on with the next case.
      Any other error → close the provider and rethrow.
    - Always `close()` the provider (`finally`).
    - Log (`createLog("mail")` as the other tools): `deliver <mailboxId>: moved <n>, in inbox <n>, duplicates removed <n>, synced <n>, not found <n>`. No ids from mail data, no paths.
  - Test (all in `mail-deliver.test.ts`: `withRollback`; the mailbox with its stored password comes from `connectMailbox`
    (as in `mail-seed.test.ts`) with `openProvider` returning the fake and a `verifySmtp` stub that resolves; the address is the test's `testAddress`;
    `createFakeMailProvider` is passed to `deliverTestMail` through `openProvider` (a spy that counts calls); test 7 uses GreenMail):
    1. `testAddress` undefined → throws `TEST_MAILBOX_ADDRESS is not set`; another address → throws; `openProvider` was never called.
    2. `sender` = the mailbox address → throws; 201 wanted → throws; `openProvider` not called.
    3. mail a in `Oferty`, b in INBOX, c already in `emails`, d nowhere, e in `Oferty` from another sender with a's id →
       results a `moved`, b `in_inbox`, c `synced`, d `not_found`; e is still in `Oferty`; a is in INBOX of the fake.
    4. Copy path (`capabilities: { move: false, uidplus: true }`): a in `Oferty`; `failOn("deleteMessage", …)` once → the call throws; the fake has a in INBOX and in `Oferty`;
       a second run → `duplicate_removed`; `Oferty` is empty.
    5. All wanted ids synced, one leftover copy in `Oferty` → results `synced`; the copy is deleted; the INBOX copy stays.
    6. `moveMessage` throws `MailNotFoundError` (fake `failOn`) → that case `not_found`, the next case still runs.
    7. Junk: the fake with `folderSpecialUse: { "Wiadomości-śmieci": "\\Junk" }` and mail a there → `moved`, folder `junk`.
    8. `checkOnly: true` with mail a in `Oferty` → result `moved` with one `move` op, and a is still in `Oferty` (no provider write call in `calls`).
    9. `sender` `x@other.test` → throws before any provider call.
    10. (GreenMail, like `mail-seed.test.ts`: `connectMailbox` on GreenMail, `ensureFolder("Oferty")`, APPEND 2 messages there with known
        `Message-ID`s, one from the sender and one from `other@x.test`) → after `deliverTestMail` the sender's mail is in INBOX and `Oferty` keeps only the other one;
        a repeat run gives `in_inbox`.
  - Check: `bun run lint && bun run typecheck && bun run test:unit && bun run dev:up && bun run db:migrate && bun run test:int`
  - Done when: tests 1–10 pass; `docs/code-patterns.md` "Side effects" lists `testmail-target deliver` next to `mailbox:seed` and `mailbox:probe-move` (one line).
  - Out of scope: the CLI (stage 6), the remote runner (stage 7).
