import type { Category } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { listActionsForEmail } from "../../src/modules/actions";
import { ensureSyncFolders, getJunkFolderPath } from "../../src/modules/mail";
import { triageOne, type TriageMailbox, noGateEvidence } from "../../src/modules/triage";
import type { DB } from "../../src/platform/db";

import { insertDelegate, noSuspiciousContext } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import {
  now,
  results,
  emailStatus,
  fakeLlm,
  analysis,
  setupMail,
  triageDeps,
  delegationRows,
} from "./triage-service-helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

describe("triageOne: the plan by the source folder (D11)", () => {
  const JUNK = "Wiadomości-śmieci";
  const folders = [
    { key: "offers", path: "Oferty", role: "sort" },
    { key: "junk", path: JUNK, role: "junk" },
  ] as const;

  async function folderSetup(
    trx: Transaction<DB>,
    opts: {
      sourceFolder: string;
      from?: string;
      rules?: TriageMailbox["rules"];
      auto?: readonly Category[];
      junkRow?: boolean;
      createDraft?: boolean;
    }
  ) {
    const base = await setupMail(
      trx,
      { from_address: opts.from ?? "jan@klient.test", source_folder: opts.sourceFolder },
      opts.rules ?? []
    );
    const delegateId = await insertDelegate(trx, base.ctx, {
      name: "Anna",
      email: "anna@firma.test",
      tags: ["offers"],
    });
    if (opts.junkRow !== false) await ensureSyncFolders(trx, base.ctx, base.mailbox.id, folders, now);
    const mailbox: TriageMailbox = {
      ...base.mailbox,
      mode: "assist",
      toolSwitches: {
        move: true,
        mark_read: true,
        flag: true,
        create_draft: opts.createDraft ?? false,
        move_unsure: false,
      },
      runningKey: noGateEvidence.runningKey,
      policy: Object.fromEntries((opts.auto ?? []).map((category) => [category, { auto: true }])),
      delegates: [{ id: delegateId, name: "Anna", email: "anna@firma.test", tags: ["offers"] }],
      junkFolder: opts.junkRow === false ? null : await getJunkFolderPath(trx, base.ctx, base.mailbox.id),
      resumedAt: null,
      suspicious: noSuspiciousContext,
      urgencyProfile: null,
    };
    return { ...base, mailbox, delegateId };
  }

  async function run(
    trx: Transaction<DB>,
    setup: Awaited<ReturnType<typeof folderSetup>>,
    category: string,
    overrides: Record<string, unknown> = {}
  ) {
    const llm = fakeLlm(analysis({ category, ...overrides }));
    const outcome = await triageOne(triageDeps(trx, llm), setup.ctx, setup.mailbox, setup.email);
    expect(outcome).toEqual({ kind: "triaged" });
    const actions = await listActionsForEmail(trx, setup.ctx, setup.emailId);
    return { llm, actions };
  }

  const types = (actions: { type: string }[]) => actions.map((a) => a.type).sort();

  test("1. spam folder mail, LLM spam: triaged, no actions row", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx, { sourceFolder: JUNK });
      const { actions } = await run(trx, s, "spam");
      expect(await emailStatus(trx, s.emailId)).toBe("triaged");
      expect(actions).toHaveLength(0);
    });
  });

  test("2. spam folder mail from a blocklisted sender: spam, no LLM call, no actions row", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx, {
        sourceFolder: JUNK,
        from: "bad@spam.test",
        rules: [{ pattern: "spam.test", kind: "blocklist" }],
      });
      const { llm, actions } = await run(trx, s, "info");
      expect(llm.requests).toHaveLength(0);
      const [row] = await results(trx, s.emailId);
      expect(row).toMatchObject({ category: "spam", reason_code: "blocklist" });
      expect(actions).toHaveLength(0);
    });
  });

  test("3. spam folder mail, urgent, auto off: one logged move to inbox, no flag", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx, { sourceFolder: JUNK });
      const { actions } = await run(trx, s, "urgent");
      expect(actions).toHaveLength(1);
      expect(actions[0]).toMatchObject({ type: "move", status: "logged", payload: { folder: "inbox" } });
    });
  });

  test("4. spam folder mail, urgent, auto on: the move to inbox is ready", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx, { sourceFolder: JUNK, auto: ["urgent"] });
      const { actions } = await run(trx, s, "urgent");
      expect(actions).toHaveLength(1);
      expect(actions[0]).toMatchObject({ type: "move", status: "ready", payload: { folder: "inbox" } });
    });
  });

  test("5. spam folder mail, info: save_summary ready, move ai_info logged", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx, { sourceFolder: JUNK });
      const { actions } = await run(trx, s, "info");
      expect(actions.map((a) => [a.type, a.status]).sort()).toEqual([
        ["move", "logged"],
        ["save_summary", "ready"],
      ]);
      expect(actions.find((a) => a.type === "move")?.payload).toEqual({ folder: "ai_info" });
    });
  });

  test("6. spam folder mail from a VIP, notification: mark_read and move ai_notifications logged", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx, {
        sourceFolder: JUNK,
        from: "boss@firma.test",
        rules: [{ pattern: "boss@firma.test", kind: "vip" }],
        auto: ["notification"],
      });
      const { actions } = await run(trx, s, "notification");
      expect(actions.map((a) => [a.type, a.status]).sort()).toEqual([
        ["mark_read", "logged"],
        ["move", "logged"],
      ]);
      expect(actions.find((a) => a.type === "move")?.payload).toEqual({ folder: "ai_notifications" });
    });
  });

  test("7. spam folder mail, delegation: one logged move to inbox, no draft, send or delegations row", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx, { sourceFolder: JUNK, createDraft: true });
      const { actions } = await run(trx, s, "delegation", {
        confidence: 0.95,
        reason_code: "direct_request",
        summary: null,
        fields: {
          due_date: "2026-11-10",
          language: "en",
          delegate_id: s.delegateId,
          task: "Prepare the offer",
          clarification: null,
        },
      });
      expect(types(actions)).toEqual(["move"]);
      expect(actions[0]).toMatchObject({ status: "logged", payload: { folder: "inbox" } });
      expect(await delegationRows(trx, s.emailId)).toHaveLength(0);
    });
  });

  test("8. sort folder mail is planned as INBOX mail: needs_reply no action, urgent flag ready", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx, { sourceFolder: "Oferty" });
      expect((await run(trx, s, "needs_reply")).actions).toHaveLength(0);
    });
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx, { sourceFolder: "Oferty" });
      const { actions } = await run(trx, s, "urgent");
      expect(actions.map((a) => [a.type, a.status])).toEqual([["flag", "ready"]]);
    });
  });

  test("9. sort folder mail, notification, auto on: mark_read and move ai_notifications ready", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx, { sourceFolder: "Oferty", auto: ["notification"] });
      const { actions } = await run(trx, s, "notification");
      expect(actions.map((a) => [a.type, a.status]).sort()).toEqual([
        ["mark_read", "ready"],
        ["move", "ready"],
      ]);
      expect(actions.find((a) => a.type === "move")?.payload).toEqual({ folder: "ai_notifications" });
    });
  });

  test("10. a disabled junk row gives the same plan; no junk row gives the plan of today", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx, { sourceFolder: JUNK });
      await trx
        .updateTable("mailbox_folders")
        .set({ enabled: false })
        .where("mailbox_id", "=", s.mailbox.id)
        .where("role", "=", "junk")
        .execute();
      // The snapshot is read after the change.
      const mailbox = { ...s.mailbox, junkFolder: await getJunkFolderPath(trx, s.ctx, s.mailbox.id) };
      expect(mailbox.junkFolder).toBe(JUNK);
      const outcome = await triageOne(
        triageDeps(trx, fakeLlm(analysis({ category: "urgent" }))),
        s.ctx,
        mailbox,
        s.email
      );
      expect(outcome).toEqual({ kind: "triaged" });
      const actions = await listActionsForEmail(trx, s.ctx, s.emailId);
      expect(actions).toHaveLength(1);
      expect(actions[0]).toMatchObject({ type: "move", status: "logged", payload: { folder: "inbox" } });
    });
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx, { sourceFolder: JUNK, junkRow: false });
      const { actions } = await run(trx, s, "urgent");
      expect(actions.map((a) => [a.type, a.status])).toEqual([["flag", "ready"]]);
    });
  });
});
