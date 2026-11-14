import { randomBytes } from "node:crypto";
import { resolve } from "node:path";

import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { INBOX, signalsOfMailbox, SIGNALS_CONTENT_LIMIT, type SeedMessage } from "../../src/modules/mail";
import { createFakeMailProvider } from "../../src/modules/mail/fake";
import { insertCredentials } from "../../src/modules/mail/repo";
import { createSecretBox } from "../../src/platform/crypto";
import type { DB, TenantContext } from "../../src/platform/db";
import { readSignalsOptions, signalsLines } from "../../src/scripts/mailbox-signals-args";

import { createOrgWithMailbox } from "./fixtures";
import { testDb, withRollback } from "./helpers";

// The fake provider through the `openProvider` seam, as `mail-backfill.test.ts` does for `backfillMailbox`.
const db = testDb();
const repoRoot = resolve(import.meta.dir, "../../../..");

afterAll(async () => {
  await db.destroy();
});

const secrets = createSecretBox(randomBytes(32).toString("base64"), 1);
const NOW = new Date("2026-11-10T12:00:00Z");
const DAY_MS = 86_400_000;
const SINCE = new Date(NOW.getTime() - 30 * DAY_MS);

function seed(n: number, headers?: Record<string, string>): SeedMessage {
  return {
    messageId: `<sig${n}@x.test>`,
    from: `sender${n}@secret.test`,
    to: ["box@x.test"],
    subject: `Private subject ${n}`,
    date: NOW,
    text: `Body ${n}`,
    headers,
  };
}

async function setup(trx: Transaction<DB>) {
  const { orgId, mailboxId } = await createOrgWithMailbox(trx);
  const ctx: TenantContext = { orgId };
  const secret = secrets.encrypt("pw", `mailbox:${mailboxId}`);
  await insertCredentials(trx, ctx, {
    mailboxId,
    encryptedSecret: secret.ciphertext,
    secretKind: "password",
    keyVersion: secret.keyVersion,
  });
  return { ctx, mailboxId, fake: createFakeMailProvider() };
}

const inWindow = { internalDate: new Date(NOW.getTime() - DAY_MS) };

describe("signalsOfMailbox", () => {
  test("counts flags and captured headers of the window; closes the provider", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const first = s.fake.deliver(INBOX, seed(1), inWindow);
      s.fake.setFlags(INBOX, first, { add: ["\\Answered", "\\Seen"] });
      const second = s.fake.deliver(INBOX, seed(2), inWindow);
      s.fake.setFlags(INBOX, second, { add: ["\\Flagged"] });
      s.fake.deliver(
        INBOX,
        seed(3, { "Authentication-Results": "mx.test.example; dkim=pass", "List-Unsubscribe": "<https://u.test/x>" }),
        inWindow
      );
      s.fake.deliver(INBOX, seed(4), { internalDate: new Date(NOW.getTime() - 60 * DAY_MS) });

      const signals = await signalsOfMailbox(
        { db: trx, secrets, openProvider: async () => s.fake },
        s.ctx,
        s.mailboxId,
        SINCE
      );

      expect(signals).toEqual({
        mails: 3,
        answered: 1,
        seen: 1,
        flagged: 1,
        contentRead: 3,
        captureFailed: 0,
        authResults: 1,
        authservIds: { "mx.test.example": 1 },
        listUnsubscribe: 1,
        partsUnknown: 0,
      });
      expect(s.fake.closed).toBe(true);
      expect(SIGNALS_CONTENT_LIMIT).toBe(200);

      const text = signalsLines(signals).join("\n");
      expect(text).toContain("authserv mx.test.example 1");
      expect(text).not.toContain("secret.test");
      expect(text).not.toContain("Private subject");
    });
  });

  test("an Authentication-Results value that is not a host name counts as other", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      s.fake.deliver(INBOX, seed(1, { "Authentication-Results": "Weird Name; spf=pass" }), inWindow);
      s.fake.deliver(INBOX, seed(2, { "Authentication-Results": "MX.Test.Example; spf=pass" }), inWindow);

      const signals = await signalsOfMailbox(
        { db: trx, secrets, openProvider: async () => s.fake },
        s.ctx,
        s.mailboxId,
        SINCE
      );

      expect(signals.authResults).toBe(2);
      expect(signals.authservIds).toEqual({ other: 1, "mx.test.example": 1 });
    });
  });

  test("more than 10 server names: the rest counts under other", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      for (let n = 1; n <= 12; n += 1) {
        s.fake.deliver(
          INBOX,
          seed(n, { "Authentication-Results": `mx${String(n).padStart(2, "0")}.test; spf=pass` }),
          inWindow
        );
      }
      const signals = await signalsOfMailbox(
        { db: trx, secrets, openProvider: async () => s.fake },
        s.ctx,
        s.mailboxId,
        SINCE
      );
      expect(Object.keys(signals.authservIds)).toHaveLength(11);
      expect(signals.authservIds.other).toBe(2);
    });
  });

  test("the provider closes when the read fails", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      s.fake.deliver(INBOX, seed(1), inWindow);
      s.fake.failOn("fetchContent", new Error("boom"));
      await expect(
        signalsOfMailbox({ db: trx, secrets, openProvider: async () => s.fake }, s.ctx, s.mailboxId, SINCE)
      ).rejects.toThrow("boom");
      expect(s.fake.closed).toBe(true);
    });
  });
});

describe("mailbox:signals CLI", () => {
  test("a missing --mailbox-id: exit 1, the usage line, an empty stdout", async () => {
    const proc = Bun.spawn(["bun", "apps/server/src/scripts/mailbox-signals.ts", "--org-id", crypto.randomUUID()], {
      cwd: repoRoot,
      env: { ...process.env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const code = await proc.exited;
    expect(code).toBe(1);
    expect(await new Response(proc.stderr).text()).toContain("usage: bun run mailbox:signals");
    expect(await new Response(proc.stdout).text()).toBe("");
  });

  test("arguments: --days is 1 to 90, ids are uuids", () => {
    const org = crypto.randomUUID();
    const box = crypto.randomUUID();
    expect(readSignalsOptions(["--org-id", org, "--mailbox-id", box])).toEqual({
      orgId: org,
      mailboxId: box,
      days: 30,
    });
    expect(readSignalsOptions(["--org-id", org, "--mailbox-id", box, "--days", "90"])?.days).toBe(90);
    expect(readSignalsOptions(["--org-id", org, "--mailbox-id", box, "--days", "91"])).toBeUndefined();
    expect(readSignalsOptions(["--org-id", org, "--mailbox-id", box, "--days", "0"])).toBeUndefined();
    expect(readSignalsOptions(["--org-id", org, "--mailbox-id", "x"])).toBeUndefined();
    expect(readSignalsOptions(["--org-id", org])).toBeUndefined();
  });
});
