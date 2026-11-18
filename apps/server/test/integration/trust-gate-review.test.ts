import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  autoEvidence,
  barCategories,
  type BarCategory,
  type EvidenceKey,
  type GateEvidenceDeps,
  type GlobalEvidence,
} from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { autoSetter, settingsDeps } from "../../src/composition";
import { insertDefaultSettings } from "../../src/modules/config";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import { setOrgFeature } from "../../src/modules/tenancy";
import { loadGateEvidence } from "../../src/modules/triage";
import { setCategoryAutoWithEvidence } from "../../src/modules/trust";
import type { DB } from "../../src/platform/db";

import { createOrgWithMailbox } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { insertTripRow } from "./trust-fixtures";

// The repair after a review: a too-few global blocks, the four test gaps, and the whole input space of the
// evidence gate against the eligibility rule of `docs/capabilities/trust.md`, with the flag on and off. Rows roll back.
const db = testDb();
const NOW = new Date("2026-11-11T12:00:00Z");
const repoRoot = resolve(import.meta.dir, "../../../..");

afterAll(async () => {
  await db.destroy();
});

const KEY: EvidenceKey = {
  provider: "gemini",
  model: "gemini-3.5-flash-lite",
  reasoningEffort: null,
  promptVersion: "classifier-v2",
  promptParts: null,
  endpoint: "standard",
  host: null,
};

type Decision = "go" | "no-go" | "too-few" | "none";

// A gate file for `KEY` whose every category has `decision`; `none` is no file at all (the reader gives `none`).
function gateOf(
  decision: Decision,
  provisional = false,
  decisions: Partial<Record<BarCategory, GlobalEvidence["decision"]>> = {}
): GateEvidenceDeps {
  if (decision === "none") return { index: { files: [] }, runningKey: KEY };
  const categories = {} as Record<BarCategory, GlobalEvidence>;
  for (const category of barCategories) {
    const own = decisions[category] ?? decision;
    categories[category] = {
      decision: own,
      provisional,
      precision: own === "go" ? 0.99 : 0.5,
      wilsonLower: own === "go" ? 0.97 : 0.3,
      threshold: own === "go" ? 0.8 : null,
      cases: own === "too-few" ? 3 : 200,
      file: "classifier-review.json",
    };
  }
  return {
    index: { files: [{ key: KEY, file: "classifier-review.json", date: "2026-11-01", provisional, categories }] },
    runningKey: KEY,
  };
}

async function setup(trx: Transaction<DB>, gate: GateEvidenceDeps) {
  const box = await createOrgWithMailbox(trx);
  const ctx = { orgId: box.orgId };
  await insertDefaultSettings(trx, ctx, box.mailboxId);
  const settings = settingsDeps(trx, () => NOW, gate);
  return { ...box, ctx, settings, deps: { settings, testMail: NO_TEST_SENDERS } };
}

const on = (category: BarCategory, force = false) => ({ category, auto: true, force, actor: "review" });

async function policyOf(trx: Transaction<DB>, mailboxId: string) {
  const row = await trx
    .selectFrom("mailbox_settings")
    .select("category_policy")
    .where("mailbox_id", "=", mailboxId)
    .executeTakeFirstOrThrow();
  return row.category_policy as Record<string, { auto?: boolean; grant?: { by: string } }>;
}

const clearedAt = async (trx: Transaction<DB>, id: string) =>
  (await trx.selectFrom("autonomy_trips").select("cleared_at").where("id", "=", id).executeTakeFirstOrThrow())
    .cleared_at;

describe("a too-few global blocks (review blocking finding)", () => {
  test("the gate refuses a non-provisional too-few category with global_no_go, not recommended", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx, gateOf("go", false, { spam: "too-few" }));
      const result = await setCategoryAutoWithEvidence(s.deps, s.ctx, s.mailboxId, on("spam"));
      expect(result.kind).toBe("refused");
      expect(result.evidence).toMatchObject({ eligible: false, recommended: false, blocks: ["global_no_go"] });
      expect((await policyOf(trx, s.mailboxId)).spam).toBeUndefined();
    });
  });

  test("the same through autoSetter with the flag on (the route and CLI path): refused, nothing stored", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx, gateOf("go", false, { notification: "too-few" }));
      await setOrgFeature(trx, s.ctx, { flag: "trust_ladder", enabled: true, actor: "cli", now: NOW });
      const result = await autoSetter(s.settings, NO_TEST_SENDERS)(s.ctx, s.mailboxId, on("notification"));
      expect(result.kind).toBe("refused");
      expect(await policyOf(trx, s.mailboxId)).toEqual({});
    });
  });

  test("force on a too-few category sets a forced grant", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx, gateOf("go", false, { spam: "too-few" }));
      const result = await setCategoryAutoWithEvidence(s.deps, s.ctx, s.mailboxId, on("spam", true));
      expect(result.kind).toBe("changed");
      expect((await policyOf(trx, s.mailboxId)).spam?.grant?.by).toBe("forced");
    });
  });

  test("the real reader on a non-provisional copy of the committed v3 gate file, spam 'no-go: too few'", () => {
    const dir = mkdtempSync(join(tmpdir(), "f110-too-few-"));
    try {
      const file = JSON.parse(
        readFileSync(
          join(repoRoot, "evals/results/gate/classifier-classifier-v3-gpt-6-luna-none-lab-01-v1.json"),
          "utf8"
        )
      ) as { provisional: boolean; categories: Record<string, Record<string, unknown>> };
      file.provisional = false;
      file.categories.spam = { ...file.categories.spam, decision: "no-go: too few", threshold: null };
      writeFileSync(join(dir, "classifier-x.json"), JSON.stringify(file));
      const index = loadGateEvidence(dir, { quiet: true });
      expect(index.files).toHaveLength(1);
      const spam = index.files[0]?.categories.spam as GlobalEvidence;
      expect(spam).toMatchObject({ decision: "too-few", provisional: false });
      const result = autoEvidence({
        category: "spam",
        global: spam,
        history: null,
        trip: { tripped: false, reason: null, at: null },
        realLabels: { kept: 0, decision: "too-few" },
      });
      expect(result).toEqual({ eligible: false, recommended: false, blocks: ["global_no_go"] });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the four test gaps of the review", () => {
  test("TG1: auto already on under the running key, an active trip, turned on again: no change, the trip is cleared", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx, gateOf("go"));
      await setCategoryAutoWithEvidence(s.deps, s.ctx, s.mailboxId, on("info"));
      const trip = await insertTripRow(trx, s.ctx, s.mailboxId, { category: "info" });
      const again = await setCategoryAutoWithEvidence(s.deps, s.ctx, s.mailboxId, on("info"));
      expect(again.kind === "changed" && again.change.changed).toBe(false);
      expect(await clearedAt(trx, trip)).toEqual(NOW);
    });
  });

  test("TG2: a trip of another category does not block, does not stop recommended", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx, gateOf("go"));
      const other = await insertTripRow(trx, s.ctx, s.mailboxId, { category: "spam" });
      const result = await setCategoryAutoWithEvidence(s.deps, s.ctx, s.mailboxId, on("info"));
      expect(result.kind).toBe("changed");
      expect(result.evidence).toMatchObject({ eligible: true, recommended: true, blocks: [] });
      // The trip of `spam` stays active.
      expect(await clearedAt(trx, other)).toBeNull();
    });
  });

  test("TG3: flag off, auto off, an active trip: the trip stays", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx, gateOf("go"));
      const trip = await insertTripRow(trx, s.ctx, s.mailboxId, { category: "info" });
      await autoSetter(s.settings, NO_TEST_SENDERS)(s.ctx, s.mailboxId, { ...on("info"), auto: false });
      expect(await clearedAt(trx, trip)).toBeNull();
    });
  });

  test("TG4: a grant that is not forced has no `blocks` in the audit row; a forced one has", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx, gateOf("go", false, { spam: "no-go" }));
      await setCategoryAutoWithEvidence(s.deps, s.ctx, s.mailboxId, on("info"));
      await setCategoryAutoWithEvidence(s.deps, s.ctx, s.mailboxId, on("spam", true));
      const rows = await trx
        .selectFrom("audit_log")
        .select("data")
        .where("org_id", "=", s.orgId)
        .where("event", "=", "mailbox.policy_changed")
        .orderBy("id")
        .execute();
      const data = rows.map((row) => row.data as Record<string, unknown>);
      expect(data).toHaveLength(2);
      expect(data[0]).toMatchObject({ field: "auto.info", forced: false });
      expect("blocks" in (data[0] ?? {})).toBe(false);
      expect(data[1]).toMatchObject({ field: "auto.spam", forced: true, blocks: "global_no_go" });
    });
  });
});

// The rule of the plan for the flag on: eligible = a non-provisional global `go` (no history, no labels here);
// recommended = eligible, no active trip and a moving category; a trip never refuses; force sets a forced grant.
const decisions: Decision[] = ["go", "no-go", "too-few", "none"];
const moving = new Set<string>(["info", "notification", "spam"]);

describe("the evidence gate over the whole input space, flag on", () => {
  test("every global decision x provisional x category x trip x force matches the rule", async () => {
    let cases = 0;
    await withRollback(db, async (trx) => {
      for (const decision of decisions) {
        for (const provisional of [false, true]) {
          // `none` has no file, so a provisional `none` is the same case.
          if (decision === "none" && provisional) continue;
          for (const category of barCategories) {
            for (const tripped of [false, true]) {
              for (const force of [false, true]) {
                cases += 1;
                const label = JSON.stringify({ decision, provisional, category, tripped, force });
                const s = await setup(trx, gateOf(decision, provisional));
                await setOrgFeature(trx, s.ctx, { flag: "trust_ladder", enabled: true, actor: "cli", now: NOW });
                const trip = tripped ? await insertTripRow(trx, s.ctx, s.mailboxId, { category }) : null;
                const result = await autoSetter(s.settings, NO_TEST_SENDERS)(s.ctx, s.mailboxId, on(category, force));

                const eligible = decision === "go" && !provisional;
                const changed = eligible || force;
                const stored = (await policyOf(trx, s.mailboxId))[category];
                expect({ label, kind: result.kind }).toEqual({ label, kind: changed ? "changed" : "refused" });
                expect({ label, auto: stored?.auto ?? false }).toEqual({ label, auto: changed });
                expect({ label, by: stored?.grant?.by }).toEqual({
                  label,
                  by: changed ? (eligible ? "evidence" : "forced") : undefined,
                });
                expect({ label, evidence: result.evidence?.eligible }).toEqual({ label, evidence: eligible });
                expect({ label, recommended: result.evidence?.recommended }).toEqual({
                  label,
                  recommended: eligible && !tripped && moving.has(category),
                });
                // A trip never refuses; it is cleared exactly when `auto` goes on.
                if (trip)
                  expect({ label, cleared: (await clearedAt(trx, trip)) !== null }).toEqual({
                    label,
                    cleared: changed,
                  });
              }
            }
          }
        }
      }
    });
    // (3 decisions x 2 provisional + none) x 5 categories x 2 trips x 2 force
    expect(cases).toBe((3 * 2 + 1) * 5 * 2 * 2);
  });
});

describe("the evidence gate over the whole input space, flag off", () => {
  test("the global evidence is ignored: with no labels every category is refused, with force it is set as forced", async () => {
    let cases = 0;
    await withRollback(db, async (trx) => {
      for (const decision of decisions) {
        for (const provisional of [false, true]) {
          if (decision === "none" && provisional) continue;
          for (const category of barCategories) {
            for (const tripped of [false, true]) {
              for (const force of [false, true]) {
                cases += 1;
                const label = JSON.stringify({ decision, provisional, category, tripped, force });
                const s = await setup(trx, gateOf(decision, provisional));
                const trip = tripped ? await insertTripRow(trx, s.ctx, s.mailboxId, { category }) : null;
                const result = await autoSetter(s.settings, NO_TEST_SENDERS)(s.ctx, s.mailboxId, on(category, force));
                const stored = (await policyOf(trx, s.mailboxId))[category];
                expect({ label, kind: result.kind, evidence: result.evidence }).toEqual({
                  label,
                  kind: force ? "changed" : "refused",
                  evidence: null,
                });
                expect({ label, by: stored?.grant?.by }).toEqual({ label, by: force ? "forced" : undefined });
                if (trip)
                  expect({ label, cleared: (await clearedAt(trx, trip)) !== null }).toEqual({ label, cleared: force });
              }
            }
          }
        }
      }
    });
    expect(cases).toBe((3 * 2 + 1) * 5 * 2 * 2);
  });
});
