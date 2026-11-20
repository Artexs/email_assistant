import { randomBytes } from "node:crypto";

import { DAY_MS, HOUR_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { isOwnActionId } from "../../src/modules/actions";
import {
  backfillInbox,
  backfillMailbox,
  MailAuthError,
  syncMailbox,
  type BackfillRefusal,
  type HistoryBackfillOutcome,
  type OAuthTokens,
} from "../../src/modules/mail";
import { createFakeMailProvider } from "../../src/modules/mail/fake";
import { protocolDisabled } from "../../src/modules/mail/oauth/login";
import { insertCredentials, updateCursor } from "../../src/modules/mail/repo";
import { createSecretBox } from "../../src/platform/crypto";
import type { DB, TenantContext } from "../../src/platform/db";
import { HardError, SoftError } from "../../src/platform/errors";

import { createOrgWithMailbox, suspendOrg } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import {
  UID_VALIDITY,
  NOW,
  SINCE_DAYS,
  ago,
  seed,
  deps,
  syncedMailbox,
  rowsOf,
  byId,
  cursorOf,
  sinceOf,
} from "./mail-history-backfill-helpers";

// The history check of the trust ladder, step 1: the INBOX backfill in the `history` purpose. The mail is stored for the history check and never reaches triage.
// The provider is the in-memory fake (no mailbox, no LLM call).
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const secrets = createSecretBox(randomBytes(32).toString("base64"), 1);

describe("history purpose: refusals are values", () => {
  const refused = (reason: BackfillRefusal): HistoryBackfillOutcome => ({ kind: "refused", reason });

  test("never synced, UIDVALIDITY change, suspended organization and a window over 180 days", async () => {
    await withRollback(db, async (trx) => {
      const s = await syncedMailbox(trx);
      const history = (since = sinceOf()) =>
        backfillInbox(deps(trx, s.fake), s.ctx, s.mailboxId, { since, purpose: "history" });

      expect(await history(ago(181 * DAY_MS))).toEqual(refused("window_too_long"));

      s.fake.resetUidValidity(UID_VALIDITY + 1);
      expect(await history()).toEqual(refused("uidvalidity_changed"));
      s.fake.resetUidValidity(UID_VALIDITY);
      expect((await rowsOf(trx, s.mailboxId)).length).toBe(1);

      await suspendOrg(trx, s.ctx.orgId);
      expect(await history()).toEqual(refused("org_suspended"));
      expect((await rowsOf(trx, s.mailboxId)).length).toBe(1);

      const other = await createOrgWithMailbox(trx);
      const never = await backfillInbox(deps(trx, createFakeMailProvider()), { orgId: other.orgId }, other.mailboxId, {
        since: sinceOf(),
        purpose: "history",
      });
      expect(never).toEqual(refused("never_synced"));
    });
  });

  test("an unknown mailbox or the mailbox of another organization is still an error", async () => {
    await withRollback(db, async (trx) => {
      const s = await syncedMailbox(trx);
      const other = await createOrgWithMailbox(trx);
      await expect(
        backfillInbox(deps(trx, s.fake), { orgId: other.orgId }, s.mailboxId, { since: sinceOf(), purpose: "history" })
      ).rejects.toBeInstanceOf(HardError);
    });
  });

  test("the purpose backfill still throws its refusals", async () => {
    await withRollback(db, async (trx) => {
      const s = await syncedMailbox(trx);
      s.fake.resetUidValidity(UID_VALIDITY + 1);
      await expect(backfillInbox(deps(trx, s.fake), s.ctx, s.mailboxId, { since: sinceOf() })).rejects.toBeInstanceOf(
        SoftError
      );
      await expect(
        backfillInbox(deps(trx, s.fake), s.ctx, s.mailboxId, { since: ago(181 * DAY_MS) })
      ).rejects.toBeInstanceOf(HardError);
    });
  });
});

describe("history purpose: backfillMailbox opens through openMailboxProvider", () => {
  async function withSecret(
    trx: Transaction<DB>,
    s: { ctx: TenantContext; mailboxId: string },
    kind: "password" | "oauth"
  ) {
    if (kind === "oauth") {
      await trx.updateTable("mailboxes").set({ oauth_provider: "google" }).where("id", "=", s.mailboxId).execute();
    }
    const sealed = secrets.encrypt(kind === "oauth" ? "{}" : "pw", `mailbox:${s.mailboxId}`);
    await insertCredentials(trx, s.ctx, {
      mailboxId: s.mailboxId,
      encryptedSecret: sealed.ciphertext,
      secretKind: kind,
      keyVersion: sealed.keyVersion,
    });
  }

  const tokens = (calls: string[]): OAuthTokens => ({
    accessToken: async (_ctx, mailboxId, _resource, opts) => {
      calls.push(opts?.fresh === true ? `fresh:${mailboxId}` : `token:${mailboxId}`);
      return "the-access-token";
    },
    drop: () => undefined,
  });

  test("7. an OAuth mailbox logs in with auth.kind oauth, stores the history rows, and closes the provider", async () => {
    await withRollback(db, async (trx) => {
      const s = await syncedMailbox(trx);
      await withSecret(trx, s, "oauth");
      const seen: string[] = [];
      const tokenCalls: string[] = [];
      const outcome = await backfillMailbox(
        {
          db: trx,
          secrets,
          isOwnActionId: async () => false,
          oauthTokens: tokens(tokenCalls),
          openProvider: async (opts) => {
            seen.push(opts.auth.kind === "oauth" ? `oauth:${opts.auth.accessToken}` : "password");
            return s.fake;
          },
        },
        s.ctx,
        s.mailboxId,
        { days: SINCE_DAYS, now: NOW, purpose: "history" }
      );
      expect(seen).toEqual(["oauth:the-access-token"]);
      expect(tokenCalls).toEqual([`token:${s.mailboxId}`]);
      expect(outcome).toMatchObject({ kind: "done", result: { stored: 2 } });
      const rows = await rowsOf(trx, s.mailboxId);
      for (const n of [2, 3]) expect(byId(rows, n)).toMatchObject({ status: "skipped", skip_reason: "history_check" });
      expect(s.fake.closed).toBe(true);
    });
  });

  test("a password mailbox opens with auth.kind password", async () => {
    await withRollback(db, async (trx) => {
      const s = await syncedMailbox(trx);
      await withSecret(trx, s, "password");
      const seen: string[] = [];
      const outcome = await backfillMailbox(
        {
          db: trx,
          secrets,
          isOwnActionId: async () => false,
          openProvider: async (opts) => {
            seen.push(opts.auth.kind);
            return s.fake;
          },
        },
        s.ctx,
        s.mailboxId,
        { days: SINCE_DAYS, now: NOW, purpose: "history" }
      );
      expect(seen).toEqual(["password"]);
      expect(outcome).toMatchObject({ kind: "done", result: { stored: 2 } });
    });
  });

  test("8. a refused login is auth_refused, not a throw: password, OAuth refused twice, and a grant the token store refuses", async () => {
    await withRollback(db, async (trx) => {
      const s = await syncedMailbox(trx);
      await withSecret(trx, s, "password");
      let opened = 0;
      const refusing = async () => {
        opened += 1;
        throw new MailAuthError("refused");
      };
      const run = (extra: Partial<Parameters<typeof backfillMailbox>[0]> = {}) =>
        backfillMailbox(
          { db: trx, secrets, isOwnActionId: async () => false, openProvider: refusing, ...extra },
          s.ctx,
          s.mailboxId,
          { days: SINCE_DAYS, now: NOW, purpose: "history" }
        );
      expect(await run()).toEqual({ kind: "refused", reason: "auth_refused" });
      expect(opened).toBe(1);
      expect((await rowsOf(trx, s.mailboxId)).length).toBe(1);
    });
    await withRollback(db, async (trx) => {
      const s = await syncedMailbox(trx);
      await withSecret(trx, s, "oauth");
      const tokenCalls: string[] = [];
      // The login is refused with the cached token and with the fresh one: `protocolDisabled`.
      const outcome = await backfillMailbox(
        {
          db: trx,
          secrets,
          isOwnActionId: async () => false,
          oauthTokens: tokens(tokenCalls),
          openProvider: async () => {
            throw new MailAuthError("IMAP login failed");
          },
        },
        s.ctx,
        s.mailboxId,
        { days: SINCE_DAYS, now: NOW, purpose: "history" }
      );
      expect(outcome).toEqual({ kind: "refused", reason: "auth_refused" });
      expect(tokenCalls).toEqual([`token:${s.mailboxId}`, `fresh:${s.mailboxId}`]);
    });
    await withRollback(db, async (trx) => {
      const s = await syncedMailbox(trx);
      await withSecret(trx, s, "oauth");
      const outcome = await backfillMailbox(
        {
          db: trx,
          secrets,
          isOwnActionId: async () => false,
          oauthTokens: {
            accessToken: async () => {
              throw new MailAuthError("oauth grant refused", { reason: "oauth_expired" });
            },
            drop: () => undefined,
          },
          openProvider: async () => s.fake,
        },
        s.ctx,
        s.mailboxId,
        { days: SINCE_DAYS, now: NOW, purpose: "history" }
      );
      expect(outcome).toEqual({ kind: "refused", reason: "auth_refused" });
    });
    expect(protocolDisabled()).toBeInstanceOf(MailAuthError);
  });

  test("a network fault at the login is an error (the job counts an attempt), and a missing OAuth wiring is an error", async () => {
    await withRollback(db, async (trx) => {
      const s = await syncedMailbox(trx);
      await withSecret(trx, s, "password");
      await expect(
        backfillMailbox(
          {
            db: trx,
            secrets,
            isOwnActionId: async () => false,
            openProvider: async () => {
              throw new SoftError("connection reset");
            },
          },
          s.ctx,
          s.mailboxId,
          { days: SINCE_DAYS, now: NOW, purpose: "history" }
        )
      ).rejects.toBeInstanceOf(SoftError);
    });
    await withRollback(db, async (trx) => {
      const s = await syncedMailbox(trx);
      await withSecret(trx, s, "oauth");
      await expect(
        backfillMailbox(
          { db: trx, secrets, isOwnActionId: async () => false, openProvider: async () => s.fake },
          s.ctx,
          s.mailboxId,
          { days: SINCE_DAYS, now: NOW, purpose: "history" }
        )
      ).rejects.toThrow("oauth not wired");
    });
  });

  test("a refusal that needs no login opens no connection and asks no token", async () => {
    await withRollback(db, async (trx) => {
      const s = await syncedMailbox(trx);
      await withSecret(trx, s, "oauth");
      let opened = 0;
      const tokenCalls: string[] = [];
      const run = (days: number) =>
        backfillMailbox(
          {
            db: trx,
            secrets,
            isOwnActionId: async () => false,
            oauthTokens: tokens(tokenCalls),
            openProvider: async () => {
              opened += 1;
              return s.fake;
            },
          },
          s.ctx,
          s.mailboxId,
          { days, now: NOW, purpose: "history" }
        );
      expect(await run(181)).toEqual({ kind: "refused", reason: "window_too_long" });
      await suspendOrg(trx, s.ctx.orgId);
      expect(await run(SINCE_DAYS)).toEqual({ kind: "refused", reason: "org_suspended" });
      expect(opened).toBe(0);
      expect(tokenCalls).toEqual([]);

      const other = await createOrgWithMailbox(trx);
      await withSecret(trx, { ctx: { orgId: other.orgId }, mailboxId: other.mailboxId }, "oauth");
      const never = await backfillMailbox(
        {
          db: trx,
          secrets,
          isOwnActionId: async () => false,
          oauthTokens: tokens(tokenCalls),
          openProvider: async () => {
            opened += 1;
            return s.fake;
          },
        },
        { orgId: other.orgId },
        other.mailboxId,
        { days: SINCE_DAYS, now: NOW, purpose: "history" }
      );
      expect(never).toEqual({ kind: "refused", reason: "never_synced" });
      expect(opened).toBe(0);
      expect(tokenCalls).toEqual([]);
    });
  });

  test("a mail with the X-EA-Action-Id of an own draft is not stored as history mail", async () => {
    await withRollback(db, async (trx) => {
      const s = await syncedMailbox(trx);
      const { insertTestEmail, insertAction } = await import("./fixtures");
      const emailId = await insertTestEmail(trx, s.ctx, s.mailboxId);
      const draftId = await insertAction(trx, s.ctx, emailId, { type: "create_draft", status: "ready" });
      s.fake.deliver("INBOX", { ...seed(6), headers: { "X-EA-Action-Id": draftId } }, { internalDate: ago(HOUR_MS) });
      // The draft is mail of before the connect: the sync cursor has passed it (a history run reads only up to the cursor).
      await updateCursor(
        trx,
        s.ctx,
        s.mailboxId,
        { uidValidity: UID_VALIDITY, lastUid: 4 },
        { uidValidity: UID_VALIDITY, lastUid: 5 }
      );
      const outcome = await backfillInbox(
        {
          ...deps(trx, s.fake),
          isOwnActionId: (ctx, mailboxId, actionId) => isOwnActionId(trx, ctx, mailboxId, actionId),
        },
        s.ctx,
        s.mailboxId,
        { since: sinceOf(), purpose: "history" }
      );
      expect(outcome).toMatchObject({ kind: "done", result: { skippedOwn: 1 } });
      expect((await rowsOf(trx, s.mailboxId)).map((row) => row.message_id_header)).not.toContain("<h6@x.test>");
    });
  });
});

describe("the history rows are normal mail rows for everything else", () => {
  test("a history mail of a mailbox does not move the cursor, and the next sync finds it above the cursor without a duplicate", async () => {
    await withRollback(db, async (trx) => {
      const s = await syncedMailbox(trx);
      const cursor = await cursorOf(trx, s.mailboxId);
      await backfillInbox(deps(trx, s.fake), s.ctx, s.mailboxId, { since: sinceOf(), purpose: "history" });
      expect(await cursorOf(trx, s.mailboxId)).toEqual(cursor);
      const next = await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      expect(next.stored).toBe(0);
      expect((await rowsOf(trx, s.mailboxId)).length).toBe(3);
    });
  });
});
