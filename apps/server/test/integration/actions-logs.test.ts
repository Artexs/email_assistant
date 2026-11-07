import { randomBytes, randomUUID } from "node:crypto";

import { encodeCallback } from "@ea/core";
import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test";

import { createCommitterJob, noDelegationHooks } from "../../src/modules/actions";
import { detectNotices, handleCallback, type LinkedChat } from "../../src/modules/channels";
import { createFakeMailProvider, type FakeMailProvider } from "../../src/modules/mail/fake";
import { insertCredentials, markSynced } from "../../src/modules/mail/repo";
import { contentHash } from "../../src/modules/mail/sync-rules";
import { createReturnedJob } from "../../src/modules/triage";
import { createSecretBox } from "../../src/platform/crypto";
import { HardError } from "../../src/platform/errors";
import { setLogLevel } from "../../src/platform/log";

import {
  createOrgWithMailbox,
  insertTriagedWithActions,
  isolateChannels,
  linkChat,
  pauseOtherMailboxes,
  randomChatId,
} from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

afterEach(() => {
  setLogLevel("info");
});

const MINUTE = 60_000;
const HOUR = 3_600_000;
const T0 = new Date("2026-11-07T12:00:00Z");
const RECEIVED = new Date(T0.getTime() - HOUR);
const secrets = createSecretBox(randomBytes(32).toString("base64"), 1);

const run = randomUUID();
const MARKERS = {
  subject: `MARKER-SUBJECT-${run}`,
  sender: `marker-sender-${run}@x.test`,
  summary: `MARKER-SUMMARY-${run}`,
};

type ActionType = "save_summary" | "flag" | "mark_read" | "move";

describe("actions logs", () => {
  test("no log line holds a subject, an address, a summary or a folder path; the expected lines appear", async () => {
    const logSpy = spyOn(console, "log").mockImplementation((): void => undefined);
    const errorSpy = spyOn(console, "error").mockImplementation((): void => undefined);
    setLogLevel("debug");
    try {
      await withRollback(db, async (trx) => {
        await isolateChannels(trx);
        await pauseOtherMailboxes(trx);
        const address = `box-${randomUUID()}@x.test`;
        const { orgId, userId, mailboxId } = await createOrgWithMailbox(trx, { address });
        const ctx = { orgId };
        const secret = secrets.encrypt("pw", `mailbox:${mailboxId}`);
        await insertCredentials(trx, ctx, {
          mailboxId,
          encryptedSecret: secret.ciphertext,
          secretKind: "password",
          keyVersion: secret.keyVersion,
        });
        await linkChat(trx, ctx, userId, randomChatId(), new Date(T0.getTime() - HOUR));
        const fake: FakeMailProvider = createFakeMailProvider();

        // A synthetic mail: delivered to the fake INBOX unless `inFake` is false.
        async function addMail(offset: number, actions: ActionType[], inFake = true) {
          const messageId = `<${randomUUID()}@ea-seed.test>`;
          const receivedAt = new Date(RECEIVED.getTime() + offset);
          let uid = 999;
          let hash = "h";
          if (inFake) {
            uid = fake.deliver(
              "INBOX",
              { messageId, from: MARKERS.sender, to: [address], subject: MARKERS.subject, date: receivedAt },
              { internalDate: receivedAt }
            );
            const meta = await fake.fetchMetaIn("INBOX", uid);
            hash = contentHash(meta as NonNullable<typeof meta>);
          }
          return insertTriagedWithActions(trx, ctx, mailboxId, {
            category: "info",
            createdAt: receivedAt,
            receivedAt,
            from: MARKERS.sender,
            subject: MARKERS.subject,
            fields: { summary: MARKERS.summary },
            messageId,
            uid,
            contentHash: hash,
            actions: actions.map((type) => ({
              type,
              status: "ready",
              ...(type === "move" ? { payload: { folder: "ai_info" } } : {}),
            })),
          });
        }

        // Oldest first: the failing flag is claimed before the others.
        const flagFails = await addMail(0, ["flag"]);
        const applied = await addMail(1, ["save_summary", "mark_read", "move"]);
        const missing = await addMail(2, ["flag"], false);

        let clock = T0;
        const committer = createCommitterJob({
          db: trx,
          secrets,
          openProvider: async () => fake,
          scope: { kind: "synthetic" },
          now: () => clock,
        });
        // The hard error hits the flag of the first mail on each of three runs.
        for (let attempt = 0; attempt < 3; attempt += 1) {
          fake.failOn("setFlags", new HardError("MARKER-ERRMSG"), 1);
          await committer.run();
          clock = new Date(clock.getTime() + 6 * MINUTE);
        }
        const states = await trx.selectFrom("actions").select(["id", "status", "status_reason"]).execute();
        const stateOf = (id: string) => states.find((row) => row.id === id);
        expect(stateOf(flagFails.actionIds[0] as string)).toMatchObject({
          status: "failed",
          status_reason: "hard_error",
        });
        expect(stateOf(missing.actionIds[0] as string)).toMatchObject({
          status: "failed",
          status_reason: "mail_not_found",
        });

        // The first run moved the mail with applied changes to AI/Info.
        const movedRow = await trx
          .selectFrom("emails")
          .select("folder")
          .where("id", "=", applied.emailId)
          .executeTakeFirstOrThrow();
        expect(movedRow.folder).toBe("AI/Info");
        expect(await fake.searchSinceIn("AI/Info", new Date(RECEIVED.getTime() - HOUR))).toHaveLength(1);

        // The Undo tap on the mail with applied changes.
        const link: LinkedChat = { orgId, userId, role: "owner", chatId: 1, linkedAt: new Date(T0.getTime() - HOUR) };
        const tap = await handleCallback(
          {
            db: trx,
            now: () => clock,
            actionsScope: { kind: "synthetic" },
            hooks: noDelegationHooks,
            uidplus: async () => true,
            sendScope: { kind: "off" },
          },
          link,
          encodeCallback({ kind: "undo", emailId: applied.emailId })
        );
        expect(tap.answer).toContain("Undo started");
        await committer.run();
        const reverseRows = await trx
          .selectFrom("actions")
          .select(["id", "type", "status"])
          .where("email_id", "=", applied.emailId)
          .where("reverses_action_id", "is not", null)
          .execute();
        expect(reverseRows.map((row) => row.status)).toEqual(["applied", "applied"]);

        // One returned mail: a user move back after a system move.
        const returned = await addMail(3, ["move"], false);
        await trx
          .updateTable("actions")
          .set({ status: "applied", applied_at: T0 })
          .where("id", "=", returned.actionIds[0] as string)
          .execute();
        await trx.updateTable("emails").set({ returned_at: clock }).where("id", "=", returned.emailId).execute();
        await createReturnedJob({ db: trx, now: () => clock }).run();

        // The failed-notice detector.
        await markSynced(trx, ctx, mailboxId, new Date(clock.getTime() - 5 * MINUTE));
        await trx
          .updateTable("mailboxes")
          .set({ status_changed_at: new Date(T0.getTime() - HOUR) })
          .where("id", "=", mailboxId)
          .execute();
        await detectNotices({ db: trx, now: () => clock, startedAt: new Date(T0.getTime() - HOUR) });
        const outbox = await trx
          .selectFrom("outbox")
          .select("id")
          .where("org_id", "=", orgId)
          .where("kind", "=", "action_failed")
          .execute();
        expect(outbox).toHaveLength(1);

        const output = [...logSpy.mock.calls, ...errorSpy.mock.calls]
          .map((call: unknown[]) => call.map(String).join(" "))
          .join("\n");

        for (const marker of [
          MARKERS.subject,
          MARKERS.sender,
          MARKERS.summary,
          "@x.test",
          "ea-seed.test",
          "AI/Info",
          "MARKER-ERRMSG",
        ]) {
          expect(output).not.toContain(marker);
        }

        expect(output).toContain(`committer ${mailboxId}: applied 3, failed 1, retry 1`);
        expect(output).toContain(`committer ${mailboxId}: applied 0, failed 0, retry 1`);
        expect(output).toContain(`committer ${mailboxId}: applied 0, failed 1, retry 0`);
        expect(output).toContain(`action ${missing.actionIds[0]}: failed mail_not_found`);
        expect(output).toContain(`action ${flagFails.actionIds[0]}: HardError, try 1 of 3`);
        expect(output).toContain(`action ${flagFails.actionIds[0]}: failed hard_error`);
        for (const reverse of reverseRows) {
          expect(output).toContain(`action ${reverse.id}: applied ${reverse.type}`);
        }
        expect(output).toContain(`returned ${mailboxId}: processed 1`);
        expect(output).toContain(`notice action_failed queued: outbox ${outbox[0]?.id}`);
      });
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});
