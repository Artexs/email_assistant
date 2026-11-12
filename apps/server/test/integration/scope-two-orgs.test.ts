import { randomBytes, randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { Transaction } from "kysely";

import {
  approve,
  createCommitterJob,
  expireReady,
  noDelegationHooks,
  type ActionsScope,
  type SendScope,
} from "../../src/modules/actions";
import {
  insertDefaultSettings,
  setCategoryAuto,
  setMode,
  setToolSwitch,
  type SettingsDeps,
} from "../../src/modules/config";
import {
  mailboxHasUidplus,
  type ImapConnectOptions,
  type MailSender,
  type SmtpConnectOptions,
} from "../../src/modules/mail";
import { createFakeMailProvider, type FakeMailProvider } from "../../src/modules/mail/fake";
import { createFakeMailSender } from "../../src/modules/mail/fake/sender";
import { insertCredentials } from "../../src/modules/mail/repo";
import { contentHash } from "../../src/modules/mail/sync-rules";
import { createLlmPause, createTriageJob, type TriageScope } from "../../src/modules/triage";
import { createSecretBox } from "../../src/platform/crypto";
import type { DB, TenantContext } from "../../src/platform/db";
import type { LlmClient } from "../../src/platform/llm";

import { createOrgWithMailbox, insertDraftAndSend, insertTestEmail, pauseOtherMailboxes } from "./fixtures";
import { testDb, withRollback } from "./helpers";

// F077 stage 2 (D2 end to end): two organizations under scope `all`. The mode, the `auto` flags, the switches and the
// tap of each mailbox stay the consent; no gate reads a mailbox address.

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const HOUR = 3_600_000;
const MINUTE = 60_000;
const NOW = new Date("2026-11-12T10:00:00Z");
const RECEIVED = new Date(NOW.getTime() - HOUR);
const GATE_FORCED = { decision: "skipped", precision: null, kept: 0, forced: true } as const;
const secrets = createSecretBox(randomBytes(32).toString("base64"), 1);

// The triage job logs through `console.error` for its own cases; keep the test output clean.
let errorSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  errorSpy = spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  errorSpy.mockRestore();
});

interface FakeLlm extends LlmClient {
  prompts: string[];
}

const infoAnswer = {
  category: "info",
  confidence: 0.9,
  reason_code: "newsletter",
  reason: "a newsletter",
  summary: "short summary",
  fields: { due_date: null, language: "pl", delegate_id: null, task: null, clarification: null },
};

function fakeLlm(): FakeLlm {
  const prompts: string[] = [];
  return {
    classifierModel: "fake-model",
    prompts,
    async classify(req) {
      prompts.push(req.prompt);
      return {
        data: req.schema.parse(infoAnswer),
        usage: { model: "fake-model", tokensIn: 100, tokensOut: 20, latencyMs: 300 },
      };
    },
  } as FakeLlm;
}

function triageJob(trx: Transaction<DB>, llm: LlmClient, scope: TriageScope) {
  return createTriageJob({
    db: trx,
    llm,
    pause: createLlmPause(),
    scope,
    batchSize: 10,
    dailyCap: 1000,
    now: () => NOW,
  });
}

interface Box {
  orgId: string;
  userId: string;
  mailboxId: string;
  address: string;
  ctx: TenantContext;
  fake: FakeMailProvider;
}

// One organization with one mailbox: default settings (mode `shadow`), credentials and a fake IMAP server.
async function addOrg(trx: Transaction<DB>): Promise<Box> {
  const address = `box-${randomUUID()}@x.test`;
  const created = await createOrgWithMailbox(trx, { address });
  const ctx: TenantContext = { orgId: created.orgId };
  await insertDefaultSettings(trx, ctx, created.mailboxId);
  const secret = secrets.encrypt("pw", `mailbox:${created.mailboxId}`);
  await insertCredentials(trx, ctx, {
    mailboxId: created.mailboxId,
    encryptedSecret: secret.ciphertext,
    secretKind: "password",
    keyVersion: secret.keyVersion,
  });
  return { ...created, address, ctx, fake: createFakeMailProvider() };
}

// A pending mail: delivered to the fake INBOX and stored with the same uid and content hash, so the committer finds it.
async function addPendingMail(trx: Transaction<DB>, box: Box, messageId: string): Promise<string> {
  const uid = box.fake.deliver(
    "INBOX",
    { messageId, from: "sender@x.test", to: [box.address], subject: "news", date: RECEIVED },
    { internalDate: RECEIVED }
  );
  const meta = await box.fake.fetchMetaIn("INBOX", uid);
  return insertTestEmail(trx, box.ctx, box.mailboxId, {
    received_at: RECEIVED,
    from_address: "sender@x.test",
    to_addresses: [box.address],
    subject: "news",
    body_text: "A newsletter.",
    message_id_header: messageId,
    folder: "INBOX",
    source_folder: "INBOX",
    uid,
    inbox_uid: uid,
    content_hash: contentHash(meta as NonNullable<typeof meta>),
  });
}

function settingsDepsOf(trx: Transaction<DB>): SettingsDeps {
  return {
    db: trx,
    now: () => NOW,
    expireReady: async (t, c, filter, opts) =>
      expireReady(t, c, filter, {
        ...opts,
        sendClose: { hooks: noDelegationHooks, uidplus: await mailboxHasUidplus(t, c, filter.mailboxId) },
      }),
  };
}

async function setAssist(trx: Transaction<DB>, box: Box): Promise<SettingsDeps> {
  const deps = settingsDepsOf(trx);
  await setMode(deps, box.ctx, box.mailboxId, { mode: "assist", keepSwitches: false, actor: "test" });
  return deps;
}

interface Opener {
  openProvider(opts: ImapConnectOptions): Promise<FakeMailProvider>;
  calls: string[];
}

function openerFor(boxes: Box[]): Opener {
  const calls: string[] = [];
  return {
    calls,
    async openProvider(opts) {
      calls.push(opts.user);
      const box = boxes.find((candidate) => candidate.address === opts.user);
      if (!box) throw new Error("no fake for this address");
      return box.fake;
    },
  };
}

interface SmtpOpener {
  calls: string[];
  sender: ReturnType<typeof createFakeMailSender>;
  openSender(opts: SmtpConnectOptions): Promise<MailSender>;
}

function smtpOpener(): SmtpOpener {
  const sender = createFakeMailSender();
  const opener: SmtpOpener = {
    calls: [],
    sender,
    async openSender(opts) {
      opener.calls.push(opts.user);
      return sender;
    },
  };
  return opener;
}

function committer(
  trx: Transaction<DB>,
  opener: Opener,
  smtp: SmtpOpener,
  scope: ActionsScope = { kind: "all" },
  sendScope: SendScope = { kind: "all" }
) {
  return createCommitterJob({
    db: trx,
    secrets,
    openProvider: opener.openProvider,
    openSender: smtp.openSender,
    scope,
    sendScope,
    now: () => NOW,
  });
}

async function actionsOf(trx: Transaction<DB>, emailId: string) {
  return trx.selectFrom("actions").select(["id", "type", "status"]).where("email_id", "=", emailId).execute();
}

function statusOf(rows: { type: string; status: string }[], type: string): string | undefined {
  return rows.find((row) => row.type === type)?.status;
}

const MAILBOX_CHANGING = ["move", "mark_read", "flag", "create_draft", "send"];

async function emailStatus(trx: Transaction<DB>, id: string): Promise<string> {
  const row = await trx.selectFrom("emails").select("status").where("id", "=", id).executeTakeFirstOrThrow();
  return row.status;
}

describe("two organizations under scope all (D2)", () => {
  test("two organizations: both mailboxes are triaged under all", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const a = await addOrg(trx);
      const b = await addOrg(trx);
      const mailA = await addPendingMail(trx, a, "<a1@x.test>");
      const mailB = await addPendingMail(trx, b, "<b1@x.test>");

      const llm = fakeLlm();
      await triageJob(trx, llm, { kind: "all" }).run();

      expect(llm.prompts).toHaveLength(2);
      expect(await emailStatus(trx, mailA)).toBe("triaged");
      expect(await emailStatus(trx, mailB)).toBe("triaged");
      for (const [box, emailId] of [
        [a, mailA],
        [b, mailB],
      ] as const) {
        const results = await trx
          .selectFrom("triage_results")
          .select(["org_id", "email_id"])
          .where("email_id", "=", emailId)
          .execute();
        expect(results).toEqual([{ org_id: box.orgId, email_id: emailId }]);
      }
    });
  });

  test("shadow: no mailbox-changing action leaves logged", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const a = await addOrg(trx);
      const b = await addOrg(trx);
      await addPendingMail(trx, a, "<a2@x.test>");
      const mailB = await addPendingMail(trx, b, "<b2@x.test>");

      await triageJob(trx, fakeLlm(), { kind: "all" }).run();

      const rows = await actionsOf(trx, mailB);
      expect(statusOf(rows, "save_summary")).toBe("ready");
      expect(statusOf(rows, "move")).toBe("logged");
      for (const row of rows.filter((candidate) => MAILBOX_CHANGING.includes(candidate.type))) {
        expect(row.status).toBe("logged");
      }

      const opener = openerFor([a, b]);
      await committer(trx, opener, smtpOpener()).run();

      expect(opener.calls).not.toContain(b.address);
      expect(statusOf(await actionsOf(trx, mailB), "move")).toBe("logged");
      expect(await b.fake.searchSinceIn("AI/Info", new Date(NOW.getTime() - 2 * 24 * HOUR))).toEqual([]);
    });
  });

  test("assist with auto off: the move is logged", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const a = await addOrg(trx);
      const b = await addOrg(trx);
      await addPendingMail(trx, a, "<a3@x.test>");
      const mailB = await addPendingMail(trx, b, "<b3@x.test>");
      await setAssist(trx, b);

      await triageJob(trx, fakeLlm(), { kind: "all" }).run();

      const rows = await actionsOf(trx, mailB);
      expect(statusOf(rows, "move")).toBe("logged");
    });
  });

  test("assist with auto on: the move is applied by the committer", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const a = await addOrg(trx);
      const b = await addOrg(trx);
      const mailA = await addPendingMail(trx, a, "<a4@x.test>");
      const mailB = await addPendingMail(trx, b, "<b4@x.test>");
      const deps = await setAssist(trx, b);
      await setCategoryAuto(deps, b.ctx, b.mailboxId, {
        category: "info",
        auto: true,
        gate: GATE_FORCED,
        actor: "test",
      });

      await triageJob(trx, fakeLlm(), { kind: "all" }).run();

      const before = await actionsOf(trx, mailB);
      expect(statusOf(before, "move")).toBe("ready");
      expect(statusOf(await actionsOf(trx, mailA), "move")).toBe("logged");

      const opener = openerFor([a, b]);
      await committer(trx, opener, smtpOpener()).run();

      expect(statusOf(await actionsOf(trx, mailB), "move")).toBe("applied");
      const since = new Date(NOW.getTime() - 2 * 24 * HOUR);
      expect(await b.fake.searchSinceIn("AI/Info", since)).toHaveLength(1);
      expect(await b.fake.searchSinceIn("INBOX", since)).toHaveLength(0);
      // Organization A stays in shadow: its mail stays in the INBOX and no connection opens for it.
      expect(await a.fake.searchSinceIn("INBOX", since)).toHaveLength(1);
      expect(opener.calls).not.toContain(a.address);
    });
  });

  test("send under all needs the tap", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const a = await addOrg(trx);
      const b = await addOrg(trx);
      const deps = await setAssist(trx, b);
      await setToolSwitch(deps, b.ctx, b.mailboxId, { name: "create_draft", value: true, actor: "test" });
      const recipientA = `delegate-a-${randomUUID()}@x.test`;
      const recipientB = `delegate-b-${randomUUID()}@x.test`;
      const pairOf = (box: Box, to: string) =>
        insertDraftAndSend(trx, box.ctx, box.mailboxId, {
          createdAt: new Date(NOW.getTime() - 30 * MINUTE),
          notifiedAt: new Date(NOW.getTime() - 20 * MINUTE),
          draftStatus: "applied",
          draftProviderResult: { uid: 1, folder: "Drafts" },
          sendStatus: "awaiting_approval",
          to,
        });
      const pairA = await pairOf(a, recipientA);
      const pairB = await pairOf(b, recipientB);
      const opener = openerFor([a, b]);
      const smtp = smtpOpener();

      await committer(trx, opener, smtp).run();

      const state = async (id: string) =>
        (await trx.selectFrom("actions").select("status").where("id", "=", id).executeTakeFirstOrThrow()).status;
      expect(await state(pairB.sendId)).toBe("awaiting_approval");
      expect(smtp.sender.calls).toEqual([]);

      const approved = await approve(
        { db: trx, hooks: noDelegationHooks, uidplus: async () => true },
        b.ctx,
        pairB.sendId,
        { userId: b.userId, via: "telegram", now: new Date(NOW.getTime() + MINUTE) }
      );
      expect(approved).toEqual({ kind: "approved" });
      await committer(trx, opener, smtp).run();

      expect(await state(pairB.sendId)).toBe("applied");
      expect(smtp.sender.sent).toHaveLength(1);
      expect(smtp.sender.sent[0]?.envelope.to).toEqual([recipientB]);
      expect(smtp.calls).toEqual([b.address]);
      // Organization A has no tap: its send stays and nothing goes to its recipient.
      expect(await state(pairA.sendId)).toBe("awaiting_approval");
      expect(smtp.sender.sent.flatMap((sent) => sent.envelope.to)).not.toContain(recipientA);
    });
  });

  test("synthetic scope still limits both organizations", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const a = await addOrg(trx);
      const b = await addOrg(trx);
      const syntheticA = await addPendingMail(trx, a, "<s-a@ea-seed.test>");
      const realA = await addPendingMail(trx, a, "<r-a@x.test>");
      const syntheticB = await addPendingMail(trx, b, "<s-b@ea-seed.test>");
      const realB = await addPendingMail(trx, b, "<r-b@x.test>");

      const llm = fakeLlm();
      await triageJob(trx, llm, { kind: "synthetic" }).run();

      expect(llm.prompts).toHaveLength(2);
      expect(await emailStatus(trx, syntheticA)).toBe("triaged");
      expect(await emailStatus(trx, syntheticB)).toBe("triaged");
      expect(await emailStatus(trx, realA)).toBe("pending");
      expect(await emailStatus(trx, realB)).toBe("pending");
    });
  });
});
