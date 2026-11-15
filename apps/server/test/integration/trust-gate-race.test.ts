import { randomUUID } from "node:crypto";

import {
  barCategories,
  type BarCategory,
  type EvidenceKey,
  type GateEvidenceDeps,
  type GlobalEvidence,
} from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import { sql } from "kysely";

import { settingsDeps } from "../../src/composition";
import { insertDefaultSettings, SettingsNotFoundError } from "../../src/modules/config";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import { clearTrips, setCategoryAutoWithEvidence, type EvidenceGateDeps } from "../../src/modules/trust";
import { createDb, type Db, type TenantContext } from "../../src/platform/db";

import { createOrgWithMailbox } from "./fixtures";
import { testDb } from "./helpers";

// The "exactly one" and "only" rules of the evidence gate, with several connections and committed rows: one change and one
// audit row per real change, one clear of a trip, a grant only while `auto` is on, nothing written for a mailbox of another
// organization. Each test runs as the `app` role and as the table owner (the owner skips row-level security, so the
// `org_id` filters of the code must hold there). Each test removes its organization and its user in `finally`.
const appDb = testDb();
const ownerUrl = process.env.MIGRATOR_DATABASE_URL;
if (!ownerUrl) throw new Error("MIGRATOR_DATABASE_URL is missing: the owner role runs the race tests");
const ownerDb = createDb(ownerUrl);

afterAll(async () => {
  await Promise.all([appDb.destroy(), ownerDb.destroy()]);
});

const NOW = new Date("2026-11-11T12:00:00Z");
const PARALLEL = 8;

function keyOf(model: string): EvidenceKey {
  return {
    provider: "gemini",
    model,
    reasoningEffort: null,
    promptVersion: "classifier-v2",
    promptParts: null,
    endpoint: "standard",
    host: null,
  };
}

// A gate index with a non-provisional `go` for every category under `key`.
function goEverywhere(key: EvidenceKey): GateEvidenceDeps {
  const categories = {} as Record<BarCategory, GlobalEvidence>;
  for (const category of barCategories) {
    categories[category] = {
      decision: "go",
      provisional: false,
      precision: 0.99,
      wilsonLower: 0.97,
      threshold: 0.8,
      cases: 200,
      file: "classifier-race.json",
    };
  }
  return {
    index: { files: [{ key, file: "classifier-race.json", date: "2026-11-01", provisional: false, categories }] },
    runningKey: key,
  };
}

interface Org extends TenantContext {
  userId: string;
  mailboxId: string;
}

async function withCommittedOrg(conn: Db, run: (org: Org) => Promise<void>): Promise<void> {
  const org = await conn.transaction().execute(async (trx) => createOrgWithMailbox(trx));
  try {
    await insertDefaultSettings(conn, org, org.mailboxId);
    await run(org);
  } finally {
    await conn.deleteFrom("organizations").where("id", "=", org.orgId).execute();
    await conn.deleteFrom("users").where("id", "=", org.userId).execute();
  }
}

function gateDeps(conn: Db, key: EvidenceKey, hooks: Partial<ReturnType<typeof settingsDeps>> = {}): EvidenceGateDeps {
  return { settings: { ...settingsDeps(conn, () => NOW, goEverywhere(key)), ...hooks }, testMail: NO_TEST_SENDERS };
}

const input = (auto: boolean, category: BarCategory = "info") => ({ category, auto, force: false, actor: "race" });

async function insertTrip(conn: Db, org: Org, category: BarCategory = "info"): Promise<string> {
  const row = await conn
    .insertInto("autonomy_trips")
    .values({
      org_id: org.orgId,
      mailbox_id: org.mailboxId,
      category,
      granted_at: new Date("2026-11-09T10:00:00Z"),
      reason: "corrections",
      counts: JSON.stringify({ corrections: 2 }),
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

async function policyOf(conn: Db, mailboxId: string) {
  const row = await conn
    .selectFrom("mailbox_settings")
    .select("category_policy")
    .where("mailbox_id", "=", mailboxId)
    .executeTakeFirstOrThrow();
  return row.category_policy as Record<string, { auto?: boolean; grant?: unknown }>;
}

const policyAudit = (conn: Db, orgId: string) =>
  conn
    .selectFrom("audit_log")
    .select("data")
    .where("org_id", "=", orgId)
    .where("event", "=", "mailbox.policy_changed")
    .execute();

for (const [role, conn] of [
  ["app", appDb],
  ["owner", ownerDb],
] as const) {
  describe(`the evidence gate with several connections as the ${role} role`, () => {
    test("8 turn-ons at once: one change, one audit row, one grant, one clear of the trip", async () => {
      await withCommittedOrg(conn, async (org) => {
        const tripId = await insertTrip(conn, org);
        const deps = gateDeps(conn, keyOf("m-a"));
        const results = await Promise.all(
          Array.from({ length: PARALLEL }, () => setCategoryAutoWithEvidence(deps, org, org.mailboxId, input(true)))
        );
        const changed = results.filter((result) => result.kind === "changed" && result.change.changed);
        expect(changed).toHaveLength(1);
        expect(results.every((result) => result.kind === "changed")).toBe(true);
        expect(await policyAudit(conn, org.orgId)).toHaveLength(1);
        const entry = (await policyOf(conn, org.mailboxId)).info;
        expect(entry).toMatchObject({ auto: true, grant: { by: "evidence", key: keyOf("m-a") } });
        const trips = await conn
          .selectFrom("autonomy_trips")
          .select(["id", "cleared_at"])
          .where("mailbox_id", "=", org.mailboxId)
          .execute();
        expect(trips).toEqual([{ id: tripId, cleared_at: NOW }]);
      });
    });

    test("turn-ons and turn-offs at once: every change has one audit row; a grant exists only while auto is on", async () => {
      await withCommittedOrg(conn, async (org) => {
        const deps = gateDeps(conn, keyOf("m-a"));
        const calls = Array.from({ length: PARALLEL }, (_, i) =>
          setCategoryAutoWithEvidence(deps, org, org.mailboxId, input(i % 2 === 0))
        );
        const results = await Promise.all(calls);
        const changes = results.filter((result) => result.kind === "changed" && result.change.changed).length;
        expect(changes).toBeGreaterThan(0);
        expect(await policyAudit(conn, org.orgId)).toHaveLength(changes);
        const entry = (await policyOf(conn, org.mailboxId)).info;
        if (entry?.auto === true) expect(entry.grant).toMatchObject({ by: "evidence" });
        else expect(entry?.grant).toBeUndefined();
      });
    });

    test("a failure after the policy write undoes the policy, the audit row and the clear of the trip", async () => {
      await withCommittedOrg(conn, async (org) => {
        const tripId = await insertTrip(conn, org);
        const deps = gateDeps(conn, keyOf("m-a"), {
          clearTrips: async (trx, ctx, mailboxId, category, at) => {
            await clearTrips(trx, ctx, mailboxId, category, at);
            throw new Error("forced failure after the clear");
          },
        });
        await expect(setCategoryAutoWithEvidence(deps, org, org.mailboxId, input(true))).rejects.toThrow(
          "forced failure after the clear"
        );
        expect(await policyOf(conn, org.mailboxId)).toEqual({});
        expect(await policyAudit(conn, org.orgId)).toHaveLength(0);
        const trip = await conn
          .selectFrom("autonomy_trips")
          .select("cleared_at")
          .where("id", "=", tripId)
          .executeTakeFirstOrThrow();
        expect(trip.cleared_at).toBeNull();
      });
    });

    test("a mailbox of another organization: not found, and its policy, trips and audit stay as they were", async () => {
      await withCommittedOrg(conn, async (victim) => {
        await withCommittedOrg(conn, async (caller) => {
          const tripId = await insertTrip(conn, victim);
          const deps = gateDeps(conn, keyOf("m-a"));
          for (const auto of [true, false]) {
            await expect(
              setCategoryAutoWithEvidence(deps, caller, victim.mailboxId, input(auto))
            ).rejects.toBeInstanceOf(SettingsNotFoundError);
          }
          await expect(
            setCategoryAutoWithEvidence(deps, caller, victim.mailboxId, { ...input(true), force: true })
          ).rejects.toBeInstanceOf(SettingsNotFoundError);
          expect(await policyOf(conn, victim.mailboxId)).toEqual({});
          expect(await policyAudit(conn, victim.orgId)).toHaveLength(0);
          const trip = await conn
            .selectFrom("autonomy_trips")
            .select("cleared_at")
            .where("id", "=", tripId)
            .executeTakeFirstOrThrow();
          expect(trip.cleared_at).toBeNull();
        });
      });
    });

    test("every place that copies the grant key goes with the organization: policy, audit rows and trips", async () => {
      const model = `copy-${randomUUID()}`;
      // Rows that carry the key: the policy row (the grant) and the audit row (the `grant_model` field).
      const copies = async () => {
        const policy = await sql<{ n: number }>`
          select count(*)::int as n from mailbox_settings where category_policy::text like ${`%${model}%`}`.execute(
          conn
        );
        const audit = await sql<{ n: number }>`
          select count(*)::int as n from audit_log where data->>'grant_model' = ${model}`.execute(conn);
        return [policy.rows[0]?.n, audit.rows[0]?.n];
      };
      let orgId = "";
      await withCommittedOrg(conn, async (org) => {
        orgId = org.orgId;
        await insertTrip(conn, org);
        await setCategoryAutoWithEvidence(gateDeps(conn, keyOf(model)), org, org.mailboxId, input(true));
        expect(await copies()).toEqual([1, 1]);
      });
      // The organization is deleted: no row keeps the key or the trip.
      expect(await copies()).toEqual([0, 0]);
      const trips = await conn.selectFrom("autonomy_trips").select("id").where("org_id", "=", orgId).execute();
      expect(trips).toEqual([]);
    });
  });
}
