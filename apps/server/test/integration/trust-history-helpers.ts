import { randomBytes } from "node:crypto";

import { DAY_MS, HOUR_MS } from "@ea/core";
import type { EvidenceKey } from "@ea/core";

import type { SeedMessage } from "../../src/modules/mail";
import { createFakeMailProvider } from "../../src/modules/mail/fake";
import { insertCredentials, updateCursor } from "../../src/modules/mail/repo";
import { setOrgFeature } from "../../src/modules/tenancy";
import { createLlmPause } from "../../src/modules/triage";
import { createHistoryJob, queueHistoryCheck, type HistoryJobDeps } from "../../src/modules/trust";
import { createSecretBox } from "../../src/platform/crypto";
import type { Db, TenantContext } from "../../src/platform/db";
import type { LlmClient } from "../../src/platform/llm";

import { createOrgWithMailbox } from "./fixtures";

// Committed mailboxes for the tests of the history job. The job claims with a transaction of its own, so
// these tests cannot run inside a rolled-back transaction. Every test removes its organization and its user in `finally`.
// The fixed clock of a box: two hours ahead of the real time of the test, so a check that the database queues with `now()` is due.
const CLOCK_AHEAD_MS = 2 * HOUR_MS;
export const HISTORY_UID_VALIDITY = 7;

export const historySecrets = createSecretBox(randomBytes(32).toString("base64"), 1);

export const RUNNING_KEY: EvidenceKey = {
  provider: "gemini",
  model: "history-test-model",
  reasoningEffort: null,
  promptVersion: "v2",
  promptParts: null,
  endpoint: "standard",
  host: null,
};

export type FakeMail = ReturnType<typeof createFakeMailProvider>;

export interface HistoryBox extends TenantContext {
  userId: string;
  mailboxId: string;
  fake: FakeMail;
  clock: { now: Date };
  /** How many times the job opened the mailbox. */
  opens: { count: number };
}

export const seedMail = (n: number, date: Date): SeedMessage => ({
  messageId: `<h${n}-${Math.random().toString(36).slice(2)}@x.test>`,
  from: `sender${n}@x.test`,
  to: ["box@x.test"],
  subject: `History mail ${n}`,
  date,
  text: `Body ${n}`,
});

export interface BoxOptions {
  /** Mail on the server, in INBOX, 1 to N days old; the cursor sits at the newest. Default 5. */
  mails?: number;
  /** False: the mailbox never synced (no UIDVALIDITY yet). Default true. */
  synced?: boolean;
  /** `trust_ladder` for the organization. Default true. */
  flag?: boolean;
  kind?: "password" | "oauth";
}

/** A committed organization with one mailbox, its credentials, a synced INBOX cursor and a fake server holding the mail. */
export async function withHistoryBox(
  conn: Db,
  opts: BoxOptions,
  run: (box: HistoryBox) => Promise<void>
): Promise<void> {
  const mails = opts.mails ?? 5;
  const now = new Date(Date.now() + CLOCK_AHEAD_MS);
  const created = await conn.transaction().execute((trx) => createOrgWithMailbox(trx));
  const ctx: TenantContext = { orgId: created.orgId };
  try {
    const kind = opts.kind ?? "password";
    if (kind === "oauth") {
      await conn
        .updateTable("mailboxes")
        .set({ oauth_provider: "google" })
        .where("id", "=", created.mailboxId)
        .execute();
    }
    const sealed = historySecrets.encrypt(kind === "oauth" ? "{}" : "pw", `mailbox:${created.mailboxId}`);
    await insertCredentials(conn, ctx, {
      mailboxId: created.mailboxId,
      encryptedSecret: sealed.ciphertext,
      secretKind: kind,
      keyVersion: sealed.keyVersion,
    });
    const fake = createFakeMailProvider({ uidValidity: HISTORY_UID_VALIDITY });
    for (let n = 1; n <= mails; n += 1) {
      fake.deliver("INBOX", seedMail(n, now), { internalDate: new Date(now.getTime() - n * DAY_MS) });
    }
    if (opts.synced !== false) {
      await updateCursor(
        conn,
        ctx,
        created.mailboxId,
        { uidValidity: null, lastUid: null },
        { uidValidity: HISTORY_UID_VALIDITY, lastUid: mails }
      );
    }
    if (opts.flag !== false) {
      await setOrgFeature(conn, ctx, { flag: "trust_ladder", enabled: true, actor: created.userId, now });
    }
    await run({ ...created, fake, clock: { now }, opens: { count: 0 } });
  } finally {
    await conn.deleteFrom("organizations").where("id", "=", created.orgId).execute();
    await conn.deleteFrom("users").where("id", "=", created.userId).execute();
  }
}

/** A model client that must not be called: the tests of the backfill and the flags steps make no model call. */
export const noLlm: LlmClient = {
  modelOf: () => RUNNING_KEY.model,
  endpointOf: () => "standard",
  providerOf: () => "openai",
  generate: () => Promise.reject(new Error("the model must not be called")),
};

/** The job over a box: the opener hands out the fake server and counts the opens. */
export function jobOf(conn: Db, box: HistoryBox, over: Partial<HistoryJobDeps> = {}) {
  return createHistoryJob({
    db: conn,
    secrets: historySecrets,
    openProvider: async () => {
      box.opens.count += 1;
      return box.fake;
    },
    isOwnActionId: async () => false,
    runningKey: RUNNING_KEY,
    gateIndex: { files: [] },
    llm: noLlm,
    pause: createLlmPause(),
    scope: { kind: "all" },
    testMail: { senders: [] },
    now: () => box.clock.now,
    ...over,
  });
}

export function advance(box: HistoryBox, ms: number): void {
  box.clock.now = new Date(box.clock.now.getTime() + ms);
}

export async function checkRows(conn: Db, box: HistoryBox) {
  return conn
    .selectFrom("history_checks")
    .selectAll()
    .where("mailbox_id", "=", box.mailboxId)
    .orderBy("created_at")
    .orderBy("id")
    .execute();
}

/** The one check of the box. */
export async function theCheck(conn: Db, box: HistoryBox) {
  const rows = await checkRows(conn, box);
  if (rows.length !== 1) throw new Error(`expected one check, found ${rows.length}`);
  const [row] = rows;
  if (row === undefined) throw new Error("no check");
  return row;
}

/** The helpers of the history job tests that read or queue through one database handle. */
export function historyJobKit(db: Db) {
  async function queue(box: HistoryBox, reason: "connect" | "cli" | "flag_on" = "connect"): Promise<string> {
    const id = await queueHistoryCheck(db, box, box.mailboxId, reason);
    if (id === null) throw new Error("check not queued");
    return id;
  }

  const emailsOf = (box: HistoryBox) =>
    db
      .selectFrom("emails")
      .select(["id", "status", "skip_reason", "backfilled_at"])
      .where("mailbox_id", "=", box.mailboxId)
      .execute();

  return { queue, emailsOf };
}
