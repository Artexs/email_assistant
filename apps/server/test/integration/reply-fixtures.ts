import { randomUUID } from "node:crypto";

import { MINUTE_MS } from "@ea/core";
import type { Insertable, Transaction } from "kysely";

import {
  buildDraftMessage,
  claimActions,
  createFolderResolver,
  noDelegationHooks,
  type ApplyDeps,
} from "../../src/modules/actions";
import { draftCopyHash, readDraftCopy } from "../../src/modules/actions/copy";
import { getDraft, releaseActions } from "../../src/modules/actions/repo";
import { composeMessage } from "../../src/modules/mail";
import type { FakeMailProvider } from "../../src/modules/mail/fake";
import type { DB, TenantContext } from "../../src/platform/db";

// Rows of the reply-drafts tables for the integration tests.
export type ReplyRequestOverrides = Partial<Insertable<DB["reply_requests"]>>;

// One `reply_requests` row for a mail; the defaults are a valid automatic request.
export async function insertReplyRequest(
  trx: Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  emailId: string,
  overrides: ReplyRequestOverrides = {}
): Promise<string> {
  const row = await trx
    .insertInto("reply_requests")
    .values({
      org_id: ctx.orgId,
      mailbox_id: mailboxId,
      email_id: emailId,
      thread_key: `<${randomUUID()}@x.test>`,
      folder: "INBOX",
      trigger: "auto",
      ...overrides,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

// One `mailbox_profiles` row (the mailbox id is its key).
export async function insertMailboxProfile(
  trx: Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  overrides: Partial<Insertable<DB["mailbox_profiles"]>> = {}
): Promise<void> {
  await trx
    .insertInto("mailbox_profiles")
    .values({ mailbox_id: mailboxId, org_id: ctx.orgId, ...overrides })
    .execute();
}

export interface DraftCopyHome {
  ctx: TenantContext;
  mailboxId: string;
  address: string;
  fake: FakeMailProvider;
  folderMap: Record<string, string>;
}

// A reply send compares its Drafts copy with the baseline hash of its draft. A test that sends a reply through
// `applySend` or the committer on a fake mailbox needs both: the copy of the applied draft in the fake `Drafts` folder, built as
// the draft step builds it, and `provider_result.copy_hash`. The send must be claimable (`approved`); every claimed row is released again.
export async function putDraftCopy(
  trx: Transaction<DB>,
  home: DraftCopyHome,
  ids: { draftId: string; sendId: string },
  now: Date
): Promise<void> {
  const claimed = await claimActions(trx, home.ctx, home.mailboxId, {
    now,
    limit: 50,
    staleBefore: new Date(now.getTime() - 10 * MINUTE_MS),
    filter: { mailbox: { kind: "all" }, send: { kind: "all" } },
  });
  const send = claimed.find((row) => row.id === ids.sendId);
  const draft = await getDraft(trx, home.ctx, ids.draftId);
  if (send === undefined || draft === undefined) throw new Error("the pair is not claimable");
  const deps: ApplyDeps = {
    db: trx,
    now: () => now,
    mailboxId: home.mailboxId,
    folders: createFolderResolver(
      { db: trx, now: () => now, provider: home.fake, mailboxId: home.mailboxId, folderMap: home.folderMap },
      home.ctx
    ),
    mailbox: { address: home.address, capabilities: { uidplus: true }, folderMap: home.folderMap },
    owner: { displayName: "Owner" },
    organization: { styleText: null, timezone: "Europe/Warsaw" },
    compose: composeMessage,
    sender: null,
    hooks: noDelegationHooks,
    appendFolders: new Set(),
  };
  const raw = await composeMessage(
    buildDraftMessage(deps, { ...send, id: draft.id, created_at: draft.created_at, payload: draft.payload })
  );
  const appended = await home.fake.appendMessage("Drafts", raw, ["\\Draft"], draft.created_at);
  const read = await readDraftCopy(home.fake, "Drafts", {
    actionId: draft.id,
    hintUid: appended.uid,
    since: draft.created_at,
  });
  if (read.kind !== "found") throw new Error("the copy was not stored");
  await trx
    .updateTable("actions")
    .set({
      provider_result: JSON.stringify({ folder: "Drafts", uid: appended.uid, copy_hash: draftCopyHash(read.copy) }),
    })
    .where("id", "=", draft.id)
    .execute();
  // Every row that the claim took goes back: another pair of the test may be claimable too.
  await releaseActions(
    trx,
    home.ctx,
    claimed.map((row) => row.id),
    now,
    now
  );
}
