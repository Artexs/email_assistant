import { randomUUID } from "node:crypto";

import {
  barCategories,
  noGoBodySchema,
  type BarCategory,
  type Category,
  type EvidenceKey,
  type GateEvidenceDeps,
  type GateIndexFile,
  type GlobalEvidence,
} from "@ea/core";
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { autoSetter, settingsDeps } from "../../src/composition";
import { getSettingsView, insertDefaultSettings, settingsRoutes } from "../../src/modules/config";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import { configureFeatures, setOrgFeature } from "../../src/modules/tenancy";
import { insertFeedback, insertTriageResult, type TriageResultInput } from "../../src/modules/triage";
import { setCategoryAutoWithEvidence } from "../../src/modules/trust";
import type { DB } from "../../src/platform/db";
import { settingsRouteDeps } from "../../src/web";

import { createOrgWithMailbox, insertTestEmail } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { addMailbox, deleteMailboxRow, insertCheckRow, insertTripRow } from "./trust-fixtures";
import { as, webOrg, webTestApp, type WebOrg } from "./web-helpers";

// The evidence gate behind `trust_ladder` (F110 stage 04) and the grant of both gates. Rows roll back, except the route
// tests (their organizations are committed and removed in `afterEach`).
const db = testDb();
const NOW = new Date("2026-11-11T12:00:00Z");

const KEY: EvidenceKey = {
  provider: "gemini",
  model: "gemini-3.5-flash-lite",
  reasoningEffort: null,
  promptVersion: "classifier-v2",
  promptParts: null,
  endpoint: "standard",
  host: null,
};

beforeEach(() => {
  configureFeatures({ off: [] });
});

const orgs: WebOrg[] = [];
afterEach(async () => {
  for (const org of orgs) await org.cleanup();
  orgs.length = 0;
});

afterAll(async () => {
  await db.destroy();
});

const NO_EVIDENCE: GlobalEvidence = {
  decision: "none",
  provisional: false,
  precision: null,
  wilsonLower: null,
  threshold: null,
  cases: 0,
  file: null,
};

// A gate file for `key`: `go` (threshold from `thresholds`) for the listed categories, `none`-like `no-go` for the rest.
function gateFile(
  go: Partial<Record<BarCategory, number | null>>,
  opts: { provisional?: boolean; key?: EvidenceKey } = {}
): GateIndexFile {
  const provisional = opts.provisional ?? false;
  const categories = {} as Record<BarCategory, GlobalEvidence>;
  for (const category of barCategories) {
    categories[category] =
      category in go
        ? {
            decision: "go",
            provisional,
            precision: 0.99,
            wilsonLower: 0.97,
            threshold: go[category] ?? null,
            cases: 200,
            file: "classifier-fixture.json",
          }
        : { ...NO_EVIDENCE, decision: "no-go", provisional, file: "classifier-fixture.json" };
  }
  return {
    key: opts.key ?? KEY,
    file: "classifier-fixture.json",
    date: "2026-11-01",
    provisional,
    categories,
  };
}

const gateOf = (...files: GateIndexFile[]): GateEvidenceDeps => ({ index: { files }, runningKey: KEY });

async function setup(trx: Transaction<DB>, gate: GateEvidenceDeps) {
  const box = await createOrgWithMailbox(trx);
  const ctx = { orgId: box.orgId };
  await insertDefaultSettings(trx, ctx, box.mailboxId);
  const settings = settingsDeps(trx, () => NOW, gate);
  return { ...box, ctx, settings, deps: { settings, testMail: NO_TEST_SENDERS } };
}

async function policyOf(trx: Transaction<DB>, mailboxId: string) {
  const row = await trx
    .selectFrom("mailbox_settings")
    .select("category_policy")
    .where("mailbox_id", "=", mailboxId)
    .executeTakeFirstOrThrow();
  return row.category_policy as Record<string, { auto?: boolean; threshold?: number; grant?: Record<string, unknown> }>;
}

async function policyAudit(trx: Transaction<DB>, orgId: string) {
  return trx
    .selectFrom("audit_log")
    .select(["actor", "data"])
    .where("org_id", "=", orgId)
    .where("event", "=", "mailbox.policy_changed")
    .orderBy("id")
    .execute();
}

// `n` real-label rows that the model put in `category` at 0.9; the first `wrong` are labelled another category.
async function addLabeled(
  trx: Transaction<DB>,
  box: { orgId: string; mailboxId: string },
  opts: { category: Category; n: number; wrong?: number }
) {
  const ctx = { orgId: box.orgId };
  for (let i = 0; i < opts.n; i += 1) {
    const emailId = await insertTestEmail(trx, ctx, box.mailboxId, {
      message_id_header: `<${randomUUID()}@x.test>`,
    });
    const result: TriageResultInput = {
      emailId,
      category: opts.category,
      vip: false,
      confidence: 0.9,
      reasonCode: "llm",
      reason: null,
      fields: {},
      model: "gemini-3.5-flash-lite",
      promptVersion: "classifier-v2",
      tokensIn: null,
      tokensOut: null,
      latencyMs: null,
    };
    await insertTriageResult(trx, ctx, result);
    const isWrong = i < (opts.wrong ?? 0);
    await insertFeedback(trx, ctx, {
      emailId,
      verdict: isWrong ? "wrong" : "right",
      trueCategory: isWrong ? "urgent" : opts.category,
      source: "cli",
      userId: null,
    });
  }
}

const turnOn = (category: BarCategory, extra: { force?: boolean; threshold?: number } = {}) => ({
  category,
  auto: true,
  force: extra.force ?? false,
  ...(extra.threshold === undefined ? {} : { threshold: extra.threshold }),
  actor: "test",
});

describe("setCategoryAutoWithEvidence", () => {
  test("1: global go (not provisional), no history, no labels → changed; grant evidence; threshold of the file", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx, gateOf(gateFile({ notification: 0.8 })));
      const result = await setCategoryAutoWithEvidence(s.deps, s.ctx, s.mailboxId, turnOn("notification"));
      expect(result.kind).toBe("changed");
      if (result.kind !== "changed") return;
      expect(result.evidence).toMatchObject({ eligible: true, recommended: true, blocks: [] });
      expect(result.evidence?.global.decision).toBe("go");
      const entry = (await policyOf(trx, s.mailboxId)).notification;
      expect(entry).toEqual({
        auto: true,
        threshold: 0.8,
        grant: { key: KEY, by: "evidence", at: NOW.toISOString() },
      });
      const audit = await policyAudit(trx, s.orgId);
      expect(audit).toHaveLength(1);
      expect(audit[0]?.data).toMatchObject({
        field: "auto.notification",
        to: true,
        forced: false,
        grant_by: "evidence",
        grant_model: KEY.model,
        grant_endpoint: "standard",
      });
    });
  });

  test("1b: a file with no threshold for the category keeps the current threshold; a caller value wins", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx, gateOf(gateFile({ info: null, spam: 0.9 })));
      await setCategoryAutoWithEvidence(s.deps, s.ctx, s.mailboxId, turnOn("info"));
      expect((await policyOf(trx, s.mailboxId)).info?.threshold).toBe(0.7);
      await setCategoryAutoWithEvidence(s.deps, s.ctx, s.mailboxId, turnOn("spam", { threshold: 0.95 }));
      expect((await policyOf(trx, s.mailboxId)).spam?.threshold).toBe(0.95);
    });
  });

  test("2: a provisional global go is refused with global_provisional; force → changed, grant forced, audit forced + blocks", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx, gateOf(gateFile({ notification: 0.8 }, { provisional: true })));
      const refused = await setCategoryAutoWithEvidence(s.deps, s.ctx, s.mailboxId, turnOn("notification"));
      expect(refused.kind).toBe("refused");
      if (refused.kind !== "refused") return;
      expect(refused.evidence.blocks).toEqual(["global_provisional"]);
      expect(refused.gate.decision).toBe("no-go: too few");
      expect((await policyOf(trx, s.mailboxId)).notification).toBeUndefined();
      expect(await policyAudit(trx, s.orgId)).toHaveLength(0);

      const forced = await setCategoryAutoWithEvidence(
        s.deps,
        s.ctx,
        s.mailboxId,
        turnOn("notification", { force: true })
      );
      expect(forced.kind).toBe("changed");
      expect((await policyOf(trx, s.mailboxId)).notification?.grant).toMatchObject({ by: "forced", key: KEY });
      const audit = await policyAudit(trx, s.orgId);
      expect(audit).toHaveLength(1);
      expect(audit[0]?.data).toMatchObject({ forced: true, grant_by: "forced", blocks: "global_provisional" });
    });
  });

  test("2b: force on an eligible category is no forced grant", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx, gateOf(gateFile({ info: 0.8 })));
      await setCategoryAutoWithEvidence(s.deps, s.ctx, s.mailboxId, turnOn("info", { force: true }));
      expect((await policyOf(trx, s.mailboxId)).info?.grant).toMatchObject({ by: "evidence" });
      expect((await policyAudit(trx, s.orgId))[0]?.data).toMatchObject({ forced: false });
    });
  });

  test("2c: no file for the running key (none) and a no-go file are refused with their own blocks", async () => {
    await withRollback(db, async (trx) => {
      const none = await setup(trx, gateOf());
      const noFile = await setCategoryAutoWithEvidence(none.deps, none.ctx, none.mailboxId, turnOn("info"));
      expect(noFile.kind === "refused" && noFile.evidence.blocks).toEqual(["no_global"]);

      const other = await setup(trx, gateOf(gateFile({ info: 0.8 }, { key: { ...KEY, endpoint: "eu" } })));
      const wrongEndpoint = await setCategoryAutoWithEvidence(other.deps, other.ctx, other.mailboxId, turnOn("info"));
      expect(wrongEndpoint.kind === "refused" && wrongEndpoint.evidence.blocks).toEqual(["no_global"]);

      const noGo = await setup(trx, gateOf(gateFile({ spam: 0.8 })));
      const result = await setCategoryAutoWithEvidence(noGo.deps, noGo.ctx, noGo.mailboxId, turnOn("info"));
      expect(result.kind === "refused" && result.evidence.blocks).toEqual(["global_no_go"]);
    });
  });

  test("3: a history fail for spam is refused with history_fail; another category is not blocked by it", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx, gateOf(gateFile({ spam: 0.9, info: 0.8 })));
      const failed = { outcome: "fail", acted: 80, moved: 10, upper: 0.2, total: 400, wouldMove: 120 };
      await insertCheckRow(trx, s.ctx, s.mailboxId, {
        status: "done",
        finished_at: NOW,
        result: JSON.stringify({ spam: failed }),
      });
      const refused = await setCategoryAutoWithEvidence(s.deps, s.ctx, s.mailboxId, turnOn("spam"));
      expect(refused.kind === "refused" && refused.evidence.blocks).toEqual(["history_fail"]);
      const info = await setCategoryAutoWithEvidence(s.deps, s.ctx, s.mailboxId, turnOn("info"));
      expect(info.kind).toBe("changed");
    });
  });

  test("3b: real labels at 30+ that say no-go refuse with real_labels_no_go", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx, gateOf(gateFile({ notification: 0.8 })));
      await addLabeled(trx, s, { category: "notification", n: 40, wrong: 8 });
      const refused = await setCategoryAutoWithEvidence(s.deps, s.ctx, s.mailboxId, turnOn("notification"));
      expect(refused.kind === "refused" && refused.evidence.blocks).toEqual(["real_labels_no_go"]);
      expect(refused.kind === "refused" && refused.gate.decision).toBe("no-go");
    });
  });

  test("4: an active trip does not refuse; auto on without force, grant evidence, the trip gets cleared_at", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx, gateOf(gateFile({ info: 0.8 })));
      const tripId = await insertTripRow(trx, s.ctx, s.mailboxId, { category: "info", reason: "corrections" });
      const other = await insertTripRow(trx, s.ctx, s.mailboxId, {
        category: "spam",
        granted_at: new Date("2026-11-09T10:00:00Z"),
      });
      const result = await setCategoryAutoWithEvidence(s.deps, s.ctx, s.mailboxId, turnOn("info"));
      expect(result.kind).toBe("changed");
      expect(result.kind === "changed" && result.evidence?.blocks).toEqual(["tripped"]);
      expect((await policyOf(trx, s.mailboxId)).info?.grant).toMatchObject({ by: "evidence" });
      const rows = await trx.selectFrom("autonomy_trips").select(["id", "cleared_at"]).execute();
      const byId = new Map(rows.map((row) => [row.id, row.cleared_at]));
      expect(byId.get(tripId)).toEqual(NOW);
      // The trip of another category stays.
      expect(byId.get(other)).toBeNull();
    });
  });

  test("auto off never reads the evidence, drops the grant and keeps the trips", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx, gateOf(gateFile({ info: 0.8 })));
      await setCategoryAutoWithEvidence(s.deps, s.ctx, s.mailboxId, turnOn("info"));
      const trip = await insertTripRow(trx, s.ctx, s.mailboxId, { category: "info" });
      // An index that throws when it is read: `auto: false` must not touch it.
      const throwing = {
        get index(): never {
          throw new Error("the evidence was read");
        },
        runningKey: KEY,
      } as unknown as GateEvidenceDeps;
      const off = { settings: { ...s.settings, gate: throwing }, testMail: NO_TEST_SENDERS };
      const result = await setCategoryAutoWithEvidence(off, s.ctx, s.mailboxId, { ...turnOn("info"), auto: false });
      expect(result).toMatchObject({ kind: "changed", gate: null, evidence: null });
      expect((await policyOf(trx, s.mailboxId)).info).toEqual({ auto: false, threshold: 0.8 });
      const row = await trx
        .selectFrom("autonomy_trips")
        .select("cleared_at")
        .where("id", "=", trip)
        .executeTakeFirstOrThrow();
      expect(row.cleared_at).toBeNull();
    });
  });

  test("auto on again under a new running key is a change with a new grant; the same key is no change", async () => {
    await withRollback(db, async (trx) => {
      const keyB: EvidenceKey = { ...KEY, model: "gemini-4" };
      const s = await setup(trx, gateOf(gateFile({ info: 0.8 }), gateFile({ info: 0.85 }, { key: keyB })));
      await setCategoryAutoWithEvidence(s.deps, s.ctx, s.mailboxId, turnOn("info"));
      const same = await setCategoryAutoWithEvidence(s.deps, s.ctx, s.mailboxId, turnOn("info"));
      expect(same.kind === "changed" && same.change.changed).toBe(false);
      expect(await policyAudit(trx, s.orgId)).toHaveLength(1);

      const onB = {
        settings: {
          ...s.settings,
          gate: { ...gateOf(gateFile({ info: 0.8 }), gateFile({ info: 0.85 }, { key: keyB })), runningKey: keyB },
        },
        testMail: NO_TEST_SENDERS,
      };
      const again = await setCategoryAutoWithEvidence(onB, s.ctx, s.mailboxId, turnOn("info"));
      expect(again.kind === "changed" && again.change.changed).toBe(true);
      expect((await policyOf(trx, s.mailboxId)).info?.grant).toMatchObject({ key: keyB, by: "evidence" });
      expect(await policyAudit(trx, s.orgId)).toHaveLength(2);
    });
  });

  test("5: flag off → the real-label gate; the grant is real_labels (go) or forced; the trip is cleared", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx, gateOf());
      const set = autoSetter(s.settings, NO_TEST_SENDERS);
      await addLabeled(trx, s, { category: "notification", n: 40 });
      const trip = await insertTripRow(trx, s.ctx, s.mailboxId, { category: "notification" });

      const go = await set(s.ctx, s.mailboxId, turnOn("notification"));
      expect(go).toMatchObject({ kind: "changed", evidence: null });
      expect((await policyOf(trx, s.mailboxId)).notification?.grant).toEqual({
        key: KEY,
        by: "real_labels",
        at: NOW.toISOString(),
      });
      const cleared = await trx
        .selectFrom("autonomy_trips")
        .select("cleared_at")
        .where("id", "=", trip)
        .executeTakeFirstOrThrow();
      expect(cleared.cleared_at).toEqual(NOW);

      const refused = await set(s.ctx, s.mailboxId, turnOn("spam"));
      expect(refused).toMatchObject({ kind: "refused", evidence: null });
      const forced = await set(s.ctx, s.mailboxId, turnOn("spam", { force: true }));
      expect(forced.kind).toBe("changed");
      expect((await policyOf(trx, s.mailboxId)).spam?.grant).toMatchObject({ by: "forced", key: KEY });
      expect((await policyAudit(trx, s.orgId)).at(-1)?.data).toMatchObject({ forced: true, grant_by: "forced" });
    });
  });

  test("the flag picks the gate per organization: on → evidence (no labels needed), off → labels", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx, gateOf(gateFile({ info: 0.8 })));
      const set = autoSetter(s.settings, NO_TEST_SENDERS);
      expect((await set(s.ctx, s.mailboxId, turnOn("info"))).kind).toBe("refused");
      await setOrgFeature(trx, s.ctx, { flag: "trust_ladder", enabled: true, actor: "cli", now: NOW });
      const on = await set(s.ctx, s.mailboxId, turnOn("info"));
      expect(on).toMatchObject({ kind: "changed", evidence: { eligible: true } });
      expect((await policyOf(trx, s.mailboxId)).info?.grant).toMatchObject({ by: "evidence" });
      // Another organization keeps the old gate.
      const second = await setup(trx, gateOf(gateFile({ info: 0.8 })));
      const setSecond = autoSetter(second.settings, NO_TEST_SENDERS);
      expect((await setSecond(second.ctx, second.mailboxId, turnOn("info"))).kind).toBe("refused");
    });
  });

  test("the view shows `auto` as stored: the grant does not change the settings answer", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx, gateOf(gateFile({ info: 0.8 })));
      await setCategoryAutoWithEvidence(s.deps, s.ctx, s.mailboxId, turnOn("info"));
      const view = await getSettingsView(s.settings, s.ctx, s.mailboxId);
      expect(view.categoryPolicy.info).toMatchObject({ auto: true, threshold: 0.8, grant: { by: "evidence" } });
    });
  });
});

// The route: a committed organization with a mailbox (the web helpers use the app connection); `flag` sets `trust_ladder`.
async function routeSetup(gate: GateEvidenceDeps, flag: boolean) {
  const org = await webOrg(db);
  orgs.push(org);
  const mailboxId = await db.transaction().execute((trx) => addMailbox(trx, { orgId: org.orgId }));
  if (flag) {
    await setOrgFeature(db, { orgId: org.orgId }, { flag: "trust_ladder", enabled: true, actor: "cli", now: NOW });
  }
  const app = webTestApp({
    db,
    sessions: { owner: org.ownerId, assistant: org.assistantId, other: org.otherOwnerId },
    routers: (api) => api.route("/", settingsRoutes(settingsRouteDeps(db, () => NOW, NO_TEST_SENDERS, gate))),
  });
  return { org, app, mailboxId };
}

describe("PATCH /api/settings/:mailboxId/auto/:category with the evidence gate", () => {
  test("the refused answer keeps `no_go` and `gate` and adds `blocks`; the old gate adds none", async () => {
    const on = await routeSetup(gateOf(gateFile({ notification: 0.8 }, { provisional: true })), true);
    const res = await on.app.request(
      `/api/settings/${on.mailboxId}/auto/notification`,
      as("owner", { method: "PATCH", body: { auto: true } })
    );
    expect(res.status).toBe(409);
    const body = noGoBodySchema.parse(await res.json());
    expect(body).toMatchObject({ error: "no_go", blocks: ["global_provisional"] });
    expect(body.gate.decision).toBe("no-go: too few");

    const off = await routeSetup(gateOf(gateFile({ notification: 0.8 })), false);
    const old = await off.app.request(
      `/api/settings/${off.mailboxId}/auto/notification`,
      as("owner", { method: "PATCH", body: { auto: true } })
    );
    expect(old.status).toBe(409);
    expect(Object.keys((await old.json()) as object).sort()).toEqual(["error", "gate"]);
  });

  test("6: a member who is not an owner gets 403; another organization's owner gets 404; nothing is written", async () => {
    const { app, mailboxId, org } = await routeSetup(gateOf(gateFile({ info: 0.8 })), true);
    for (const body of [{ auto: true }, { auto: true, force: true }]) {
      const member = await app.request(
        `/api/settings/${mailboxId}/auto/info`,
        as("assistant", { method: "PATCH", body })
      );
      expect(member.status).toBe(403);
      expect(await member.json()).toEqual({ error: "owner_only" });
      const stranger = await app.request(
        `/api/settings/${mailboxId}/auto/info`,
        as("other", { method: "PATCH", body })
      );
      expect(stranger.status).toBe(404);
    }
    const row = await db
      .selectFrom("mailbox_settings")
      .select("category_policy")
      .where("mailbox_id", "=", mailboxId)
      .executeTakeFirstOrThrow();
    expect(row.category_policy).toEqual({});
    const audit = await db
      .selectFrom("audit_log")
      .select("id")
      .where("org_id", "=", org.orgId)
      .where("event", "=", "mailbox.policy_changed")
      .execute();
    expect(audit).toEqual([]);
  });

  test("an owner turns an eligible category on: 200, the grant is stored", async () => {
    const { app, mailboxId } = await routeSetup(gateOf(gateFile({ info: 0.8 })), true);
    const res = await app.request(
      `/api/settings/${mailboxId}/auto/info`,
      as("owner", { method: "PATCH", body: { auto: true } })
    );
    expect(res.status).toBe(200);
    const row = await db
      .selectFrom("mailbox_settings")
      .select("category_policy")
      .where("mailbox_id", "=", mailboxId)
      .executeTakeFirstOrThrow();
    expect(row.category_policy).toMatchObject({ info: { auto: true, threshold: 0.8, grant: { by: "evidence" } } });
  });

  test("a reload removes the mailbox while the set-anyway dialog is open: the confirm answers 404 and writes nothing", async () => {
    const { app, mailboxId, org } = await routeSetup(
      gateOf(gateFile({ notification: 0.8 }, { provisional: true })),
      true
    );
    const first = await app.request(
      `/api/settings/${mailboxId}/auto/notification`,
      as("owner", { method: "PATCH", body: { auto: true } })
    );
    expect(first.status).toBe(409);
    // The dialog is open. A reload of the page (another tab removed the mailbox) deletes the row.
    await db.transaction().execute((trx) => deleteMailboxRow(trx, { orgId: org.orgId }, mailboxId));
    const confirm = await app.request(
      `/api/settings/${mailboxId}/auto/notification`,
      as("owner", { method: "PATCH", body: { auto: true, force: true } })
    );
    expect(confirm.status).toBe(404);
    expect(await confirm.json()).toEqual({ error: "not_found" });
    const audit = await db
      .selectFrom("audit_log")
      .select("id")
      .where("org_id", "=", org.orgId)
      .where("event", "=", "mailbox.policy_changed")
      .execute();
    expect(audit).toEqual([]);
    const settings = await db
      .selectFrom("mailbox_settings")
      .select("mailbox_id")
      .where("mailbox_id", "=", mailboxId)
      .execute();
    expect(settings).toEqual([]);
  });
});
