import { randomUUID } from "node:crypto";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { sql } from "kysely";

import {
  applyDraft,
  checkDraftCopy,
  claimActions,
  createFolderResolver,
  noDelegationHooks,
} from "../../src/modules/actions";
import { getDraftMailboxId } from "../../src/modules/actions/repo";
import { composeMessage, openImapProvider, type MailProvider } from "../../src/modules/mail";
import { HardError } from "../../src/platform/errors";
import { captureLogs, type CapturedLogs } from "../log-capture";

import {
  actionRow,
  builtText,
  connectOptions,
  copyBox,
  copyOf,
  deleteCopy,
  draftCopies,
  editCopy,
  greenmailOpener,
  HEX64,
  IMAP_HOST,
  IMAP_PORT,
  MINUTE,
  NOW,
  waitingPair,
  type CopyBox,
} from "./copy-hash-fixtures";
import { testDb, withRollback } from "./helpers";

// The baseline after the APPEND and the probe service: GreenMail, real copies.
const db = testDb();
const boxes: CopyBox[] = [];
let logs: CapturedLogs | null = null;

afterEach(async () => {
  logs?.stop();
  logs = null;
  for (const box of boxes) await box.close();
  boxes.length = 0;
});

afterAll(async () => {
  await db.destroy();
});

const events = (captured: CapturedLogs, event: string): Record<string, unknown>[] =>
  captured.lines
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((line): line is Record<string, unknown> => line !== null && line.event === event);

describe("the baseline after the APPEND", () => {
  test("1. a delegation draft is applied with a 64-hex copy_hash; the text is never stored", async () => {
    await withRollback(db, async (trx) => {
      const box = await copyBox(trx);
      boxes.push(box);
      const p = await waitingPair(trx, box);

      await box.committer.run();

      const draft = await actionRow(trx, p.draftId);
      expect(draft.status).toBe("applied");
      const result = draft.provider_result as Record<string, unknown>;
      expect(result.copy_hash).toMatch(HEX64);
      expect(Object.keys(result).sort()).toEqual(["copy_hash", "folder", "found", "uid"]);
      const text = await builtText(trx, box, p.draftId, p.emailId);
      expect(text.length).toBeGreaterThan(20);
      expect(JSON.stringify(draft.provider_result)).not.toContain(text.slice(0, 20));
      expect(await draftCopies(box)).toHaveLength(1);
    });
  });

  test("1b. a reply draft with a Cc is applied with a copy_hash too", async () => {
    await withRollback(db, async (trx) => {
      const box = await copyBox(trx);
      boxes.push(box);
      const p = await waitingPair(trx, box, { kind: "reply", cc: ["ala@example.com", "tom@example.com"] });

      await box.committer.run();

      const result = (await actionRow(trx, p.draftId)).provider_result as Record<string, unknown>;
      expect(result.copy_hash).toMatch(HEX64);
      const meta = await copyOf(box, p.draftId);
      expect(meta?.cc).toEqual(["ala@example.com", "tom@example.com"]);
    });
  });

  test("2. a crash after the APPEND: the next claim locates the copy, hashes it, applies; one copy in Drafts", async () => {
    await withRollback(db, async (trx) => {
      const box = await copyBox(trx);
      boxes.push(box);
      const p = await waitingPair(trx, box);
      const provider = await openImapProvider({
        host: IMAP_HOST,
        port: IMAP_PORT,
        user: box.address,
        auth: { kind: "password", password: "greenmail-test" },
      });
      boxes.push({ ...box, close: () => provider.close() });
      const [claimed] = await claimActions(trx, box.ctx, box.mailboxId, {
        now: NOW,
        limit: 5,
        staleBefore: new Date(NOW.getTime() - 10 * MINUTE),
        filter: { mailbox: { kind: "all" }, send: { kind: "all" } },
      });
      if (claimed === undefined || claimed.id !== p.draftId) throw new Error("the draft was not claimed");
      const folderMap = { drafts: "Drafts", sent: "Sent" };
      const deps = {
        db: trx,
        now: () => NOW,
        mailboxId: box.mailboxId,
        folders: createFolderResolver(
          { db: trx, now: () => NOW, provider, mailboxId: box.mailboxId, folderMap },
          box.ctx
        ),
        mailbox: { address: box.address, capabilities: { uidplus: true }, folderMap },
        owner: { displayName: "Owner" },
        organization: { timezone: "Europe/Warsaw" },
        compose: composeMessage,
        sender: null,
        hooks: noDelegationHooks,
        appendFolders: new Set<string>(),
      };

      await expect(
        applyDraft(
          {
            ...deps,
            beforeCommit: () => {
              throw new Error("crash");
            },
          },
          box.ctx,
          claimed,
          provider
        )
      ).rejects.toThrow("crash");
      expect(await draftCopies(box)).toHaveLength(1);
      expect((await actionRow(trx, p.draftId)).status).toBe("applying");
      // The claim goes stale: the next committer run locates the copy and finishes the row.
      await trx
        .updateTable("actions")
        .set({ locked_at: new Date(NOW.getTime() - 20 * MINUTE) })
        .where("id", "=", p.draftId)
        .execute();

      await box.committer.run();

      const draft = await actionRow(trx, p.draftId);
      expect(draft.status).toBe("applied");
      expect(draft.provider_result).toMatchObject({
        found: true,
        folder: "Drafts",
        copy_hash: expect.stringMatching(HEX64),
      });
      expect(await draftCopies(box)).toHaveLength(1);
    });
  });

  test("3. without UIDPLUS the APPEND gives no uid: the read locates the copy first and still hashes it", async () => {
    await withRollback(db, async (trx) => {
      const box = await copyBox(trx);
      boxes.push(box);
      box.wrap.provider = (provider) =>
        new Proxy(provider, {
          get(target, prop) {
            if (prop !== "appendMessage") return Reflect.get(target, prop, target) as unknown;
            return async (...args: Parameters<MailProvider["appendMessage"]>) => {
              await target.appendMessage(...args);
              return { uid: null };
            };
          },
        });
      const p = await waitingPair(trx, box);

      await box.committer.run();

      const draft = await actionRow(trx, p.draftId);
      expect(draft.status).toBe("applied");
      expect(draft.provider_result).toMatchObject({ uid: null, copy_hash: expect.stringMatching(HEX64) });
      expect(await draftCopies(box)).toHaveLength(1);
    });
  });

  test("4. a read error after a good APPEND keeps the draft applied with no copy_hash, and one event", async () => {
    await withRollback(db, async (trx) => {
      logs = captureLogs();
      const box = await copyBox(trx);
      boxes.push(box);
      box.wrap.provider = (provider) =>
        new Proxy(provider, {
          get(target, prop) {
            if (prop !== "fetchContent") return Reflect.get(target, prop, target) as unknown;
            return async () => {
              throw new HardError("read failed");
            };
          },
        });
      const p = await waitingPair(trx, box);

      await box.committer.run();

      const draft = await actionRow(trx, p.draftId);
      expect(draft.status).toBe("applied");
      expect(draft.attempts).toBe(0);
      expect(draft.provider_result).toEqual({ uid: expect.any(Number), folder: "Drafts", found: false });
      expect(await draftCopies(box)).toHaveLength(1);
      expect(events(logs, "draft_copy_unhashed")).toEqual([
        expect.objectContaining({ action_id: p.draftId, error_code: "HardError" }),
      ]);
    });
  });

  test("4b. a copy whose text cannot be read gets no copy_hash and one text_unreadable event; the draft stays applied", async () => {
    await withRollback(db, async (trx) => {
      logs = captureLogs();
      const box = await copyBox(trx);
      boxes.push(box);
      box.wrap.provider = (provider) =>
        new Proxy(provider, {
          get(target, prop) {
            if (prop !== "fetchContent") return Reflect.get(target, prop, target) as unknown;
            return async () => ({ text: null, capture: null });
          },
        });
      const p = await waitingPair(trx, box);

      await box.committer.run();

      const draft = await actionRow(trx, p.draftId);
      expect(draft.status).toBe("applied");
      expect(draft.provider_result).toEqual({ uid: expect.any(Number), folder: "Drafts", found: false });
      expect(await draftCopies(box)).toHaveLength(1);
      expect(events(logs, "draft_copy_unhashed")).toEqual([
        expect.objectContaining({ action_id: p.draftId, error_code: "text_unreadable" }),
      ]);
    });
  });
});

describe("getDraftMailboxId", () => {
  test("8. the mailbox of a draft of this organization; another organization, a send id and an unknown id give undefined", async () => {
    await withRollback(db, async (trx) => {
      const two = await copyBox(trx);
      boxes.push(two);
      const one = await copyBox(trx);
      boxes.push(one);
      const p = await waitingPair(trx, one);

      expect(await getDraftMailboxId(trx, one.ctx, p.draftId)).toBe(one.mailboxId);
      expect(await getDraftMailboxId(trx, two.ctx, p.draftId)).toBeUndefined();
      expect(await getDraftMailboxId(trx, one.ctx, p.sendId)).toBeUndefined();
      expect(await getDraftMailboxId(trx, one.ctx, randomUUID())).toBeUndefined();
    });
  });
});

describe("the probe service of reply:check-copy", () => {
  async function check(
    trx: Parameters<Parameters<typeof withRollback>[1]>[0],
    box: CopyBox,
    draftId: string,
    orgId = box.ctx.orgId
  ) {
    return checkDraftCopy({ db: trx, openProvider: greenmailOpener(box.address) }, { orgId }, draftId);
  }

  test("5. same; same again after a re-save with no change; changed after an edit; missing after a delete", async () => {
    await withRollback(db, async (trx) => {
      const box = await copyBox(trx);
      boxes.push(box);
      const p = await waitingPair(trx, box);
      await box.committer.run();
      const before = (await actionRow(trx, p.draftId)).provider_result;

      expect(await check(trx, box, p.draftId)).toEqual({ kind: "checked", result: "same" });
      // A re-save with no change keeps the hash: a server may re-encode the message.
      await editCopy(box, p.draftId);
      expect(await check(trx, box, p.draftId)).toEqual({ kind: "checked", result: "same" });
      await editCopy(box, p.draftId, { text: (text) => `${text}\n\nPS` });
      expect(await check(trx, box, p.draftId)).toEqual({ kind: "checked", result: "changed" });
      expect(await draftCopies(box)).toHaveLength(1);
      await deleteCopy(box, p.draftId);
      expect(await check(trx, box, p.draftId)).toEqual({ kind: "checked", result: "missing" });
      // The probe writes nothing to the row.
      expect((await actionRow(trx, p.draftId)).provider_result).toEqual(before);
    });
  });

  test("5b. the probe closes its connection after an answer and after an error", async () => {
    await withRollback(db, async (trx) => {
      const box = await copyBox(trx);
      boxes.push(box);
      const p = await waitingPair(trx, box);
      await box.committer.run();
      let closed = 0;
      const opener = (fail: boolean) => async () => {
        const provider = await openImapProvider(connectOptions(box.address));
        return new Proxy(provider, {
          get(target, prop) {
            if (prop === "close") {
              return async () => {
                closed += 1;
                await target.close();
              };
            }
            if (prop === "fetchContent" && fail) {
              return async () => {
                throw new HardError("read failed");
              };
            }
            return Reflect.get(target, prop, target) as unknown;
          },
        });
      };

      expect(await checkDraftCopy({ db: trx, openProvider: opener(false) }, box.ctx, p.draftId)).toEqual({
        kind: "checked",
        result: "same",
      });
      expect(closed).toBe(1);
      await expect(checkDraftCopy({ db: trx, openProvider: opener(true) }, box.ctx, p.draftId)).rejects.toThrow(
        "read failed"
      );
      expect(closed).toBe(2);
    });
  });

  test("6. a draft with no copy_hash answers no_baseline while its copy exists", async () => {
    await withRollback(db, async (trx) => {
      const box = await copyBox(trx);
      boxes.push(box);
      const p = await waitingPair(trx, box);
      await box.committer.run();
      await trx
        .updateTable("actions")
        .set((eb) => ({
          provider_result: eb.fn("jsonb_set", [eb.ref("provider_result"), sql.lit("{copy_hash}"), sql`'null'::jsonb`]),
        }))
        .where("id", "=", p.draftId)
        .execute();

      expect(await check(trx, box, p.draftId)).toEqual({ kind: "checked", result: "no_baseline" });
    });
  });

  test("7. an unknown id and the draft id of another organization both answer not_found", async () => {
    await withRollback(db, async (trx) => {
      // `copyBox` pauses the other mailboxes: the organization that runs the committer comes last.
      const two = await copyBox(trx);
      boxes.push(two);
      const one = await copyBox(trx);
      boxes.push(one);
      const p = await waitingPair(trx, one);
      await one.committer.run();

      expect(await check(trx, one, p.draftId)).toEqual({ kind: "checked", result: "same" });
      expect(await check(trx, two, p.draftId)).toEqual({ kind: "not_found" });
      expect(await check(trx, one, randomUUID())).toEqual({ kind: "not_found" });
      // A send row is not a draft.
      expect(await check(trx, one, p.sendId)).toEqual({ kind: "not_found" });
    });
  });
});
