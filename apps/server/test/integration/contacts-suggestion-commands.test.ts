import { randomUUID } from "node:crypto";

import { SENDER_RULE_LIMIT } from "@ea/core";
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { sql } from "kysely";

import { auditEvents } from "../../src/modules/audit";
import { insertSenderRule } from "../../src/modules/config/repo";
import {
  acceptSuggestion,
  countOpenSuggestions,
  dismissSuggestion,
  listOpenSuggestions,
  refreshMailboxProfiles,
  type SuggestionDeps,
} from "../../src/modules/contacts";
import { setOrgFeature } from "../../src/modules/tenancy";
import { waitFor } from "../wait-for";

import {
  ago,
  KEY,
  insertSuggestion,
  newOrg,
  NO_TEST,
  NOW,
  secondMailbox,
  seed,
  spamMails,
  withSentCoverage,
  type Org,
  type Trx,
} from "./contacts-fixtures";
import { insertDelegate } from "./fixtures";
import { testDb, withRollback } from "./helpers";

// Accept and Dismiss of a suggestion, and the readers of the open ones. Most tests run in a transaction that rolls back; the
// race tests commit their seed (two connections) and `afterEach` removes it.
const db = testDb();
const orgIds: string[] = [];
const userIds: string[] = [];
afterEach(async () => {
  if (orgIds.length > 0) await db.deleteFrom("organizations").where("id", "in", orgIds).execute();
  if (userIds.length > 0) await db.deleteFrom("users").where("id", "in", userIds).execute();
  orgIds.length = 0;
  userIds.length = 0;
});
afterAll(async () => {
  await db.destroy();
});

const deps = (trx: Trx | typeof db): SuggestionDeps => ({ db: trx, now: () => NOW, testMail: NO_TEST });

interface Seeded extends Org {
  userId: string;
}

// An organization with the flags `sender_context` and `sender_suggestions`, and its owner.
async function suggestOrg(trx: Trx): Promise<Seeded> {
  const org = await newOrg(trx);
  await setOrgFeature(trx, org.ctx, { flag: "sender_suggestions", enabled: true, actor: "cli", now: NOW });
  const owner = await trx
    .selectFrom("memberships")
    .select("user_id")
    .where("org_id", "=", org.ctx.orgId)
    .executeTakeFirstOrThrow();
  return { ...org, userId: owner.user_id };
}

const cmd = (org: Seeded, id: string, via: "web" | "cli" = "web") => ({ id, actor: org.userId, via });

const rulesOf = (trx: Trx | typeof db, org: Org) =>
  trx
    .selectFrom("sender_rules")
    .select(["pattern", "kind", "mailbox_id"])
    .where("org_id", "=", org.ctx.orgId)
    .execute();

const rowOf = (trx: Trx | typeof db, id: string) =>
  trx.selectFrom("sender_suggestions").selectAll().where("id", "=", id).executeTakeFirstOrThrow();

const auditOf = (trx: Trx | typeof db, org: Org, event: string) =>
  trx
    .selectFrom("audit_log")
    .select(["actor", "data"])
    .where("org_id", "=", org.ctx.orgId)
    .where("event", "=", event)
    .execute();

describe("acceptSuggestion", () => {
  test("1 Accept makes the sender rule of the mailbox, ends the row as accepted and writes one audit row without an address", async () => {
    await withRollback(db, async (trx) => {
      const org = await suggestOrg(trx);
      const id = await insertSuggestion(trx, org, { value: "anna@acme.pl", kind: "vip" });
      expect(await acceptSuggestion(deps(trx), org.ctx, cmd(org, id))).toBe("accepted");
      expect(await rulesOf(trx, org)).toEqual([{ pattern: "anna@acme.pl", kind: "vip", mailbox_id: org.mailboxId }]);
      const row = await rowOf(trx, id);
      expect(row).toMatchObject({ status: "accepted", pattern: null, ended_by: org.userId });
      expect(row.ended_at?.getTime()).toBe(NOW.getTime());
      const audit = await auditOf(trx, org, auditEvents.suggestionAccepted);
      expect(audit).toHaveLength(1);
      expect(audit[0]?.actor).toBe(org.userId);
      expect(audit[0]?.data).toEqual({ mailbox_id: org.mailboxId, kind: "vip", scope: "address", via: "web" });
      expect(JSON.stringify(audit)).not.toContain("@");
      expect(JSON.stringify(audit)).not.toContain("anna");
    });
  });

  test("2 Accept when the rule exists already ends the row as accepted and makes no second rule", async () => {
    await withRollback(db, async (trx) => {
      const org = await suggestOrg(trx);
      await trx
        .insertInto("sender_rules")
        .values({ org_id: org.ctx.orgId, mailbox_id: org.mailboxId, pattern: "anna@acme.pl", kind: "vip" })
        .execute();
      const id = await insertSuggestion(trx, org, { value: "anna@acme.pl", kind: "vip" });
      expect(await acceptSuggestion(deps(trx), org.ctx, cmd(org, id))).toBe("accepted");
      expect(await rulesOf(trx, org)).toHaveLength(1);
      expect((await rowOf(trx, id)).status).toBe("accepted");
    });
  });

  test("3 Accept at the rule limit answers rule_limit; the row stays open with its pattern and no audit row is written", async () => {
    await withRollback(db, async (trx) => {
      const org = await suggestOrg(trx);
      await trx
        .insertInto("sender_rules")
        .values(
          Array.from({ length: SENDER_RULE_LIMIT }, (_, i) => ({
            org_id: org.ctx.orgId,
            mailbox_id: null,
            pattern: `u${i}@limit.pl`,
            kind: "whitelist",
          }))
        )
        .execute();
      const id = await insertSuggestion(trx, org, { value: "anna@acme.pl", kind: "vip" });
      expect(await acceptSuggestion(deps(trx), org.ctx, cmd(org, id))).toBe("rule_limit");
      expect(await rulesOf(trx, org)).toHaveLength(SENDER_RULE_LIMIT);
      expect(await rowOf(trx, id)).toMatchObject({ status: "open", pattern: "anna@acme.pl", ended_at: null });
      expect(await auditOf(trx, org, auditEvents.suggestionAccepted)).toEqual([]);
    });
  });

  test("4 Accept after Dismiss answers already and makes no rule", async () => {
    await withRollback(db, async (trx) => {
      const org = await suggestOrg(trx);
      const id = await insertSuggestion(trx, org, { value: "anna@acme.pl", kind: "vip" });
      expect(await dismissSuggestion(deps(trx), org.ctx, cmd(org, id))).toBe("dismissed");
      expect(await acceptSuggestion(deps(trx), org.ctx, cmd(org, id))).toBe("already");
      expect(await rulesOf(trx, org)).toEqual([]);
      expect(await auditOf(trx, org, auditEvents.suggestionAccepted)).toEqual([]);
      // A second Accept and a second Dismiss answer the same.
      expect(await acceptSuggestion(deps(trx), org.ctx, cmd(org, id))).toBe("already");
      expect(await dismissSuggestion(deps(trx), org.ctx, cmd(org, id))).toBe("already");
    });
  });

  test("4b a row that is already accepted, withdrawn or expired answers already", async () => {
    await withRollback(db, async (trx) => {
      const org = await suggestOrg(trx);
      for (const status of ["withdrawn", "expired", "accepted"] as const) {
        const id = await insertSuggestion(trx, org, { value: `${status}@acme.pl`, kind: "vip" });
        await trx
          .updateTable("sender_suggestions")
          .set({ status, pattern: null, ended_at: NOW })
          .where("id", "=", id)
          .execute();
        expect(await acceptSuggestion(deps(trx), org.ctx, cmd(org, id))).toBe("already");
        expect(await dismissSuggestion(deps(trx), org.ctx, cmd(org, id))).toBe("already");
      }
      expect(await rulesOf(trx, org)).toEqual([]);
    });
  });

  test("6 an id of another organization, an unknown id and a text that is no id answer not_found", async () => {
    await withRollback(db, async (trx) => {
      const a = await suggestOrg(trx);
      const b = await suggestOrg(trx);
      const idB = await insertSuggestion(trx, b, { value: "anna@acme.pl", kind: "vip" });
      expect(await acceptSuggestion(deps(trx), a.ctx, cmd(a, idB))).toBe("not_found");
      expect(await dismissSuggestion(deps(trx), a.ctx, cmd(a, idB))).toBe("not_found");
      expect(await acceptSuggestion(deps(trx), a.ctx, cmd(a, randomUUID()))).toBe("not_found");
      expect(await acceptSuggestion(deps(trx), a.ctx, cmd(a, "not-an-id"))).toBe("not_found");
      expect(await rowOf(trx, idB)).toMatchObject({ status: "open", pattern: "anna@acme.pl" });
      expect(await rulesOf(trx, b)).toEqual([]);
    });
  });

  test("7 a domain suggestion becomes a rule with no `@`; a rule with `@` would never match", async () => {
    await withRollback(db, async (trx) => {
      const org = await suggestOrg(trx);
      const id = await insertSuggestion(trx, org, { value: "@acme.pl", scope: "domain", kind: "blocklist" });
      expect(await acceptSuggestion(deps(trx), org.ctx, cmd(org, id, "cli"))).toBe("accepted");
      expect(await rulesOf(trx, org)).toEqual([{ pattern: "acme.pl", kind: "blocklist", mailbox_id: org.mailboxId }]);
      const audit = await auditOf(trx, org, auditEvents.suggestionAccepted);
      expect(audit[0]?.data).toEqual({ mailbox_id: org.mailboxId, kind: "blocklist", scope: "domain", via: "cli" });
    });
  });

  test("7b a pattern that no sender rule can hold ends the row as withdrawn and makes no rule", async () => {
    await withRollback(db, async (trx) => {
      const org = await suggestOrg(trx);
      const id = await insertSuggestion(trx, org, { value: "@bücher.de", scope: "domain", kind: "whitelist" });
      expect(await acceptSuggestion(deps(trx), org.ctx, cmd(org, id))).toBe("not_found");
      expect(await rowOf(trx, id)).toMatchObject({ status: "withdrawn", pattern: null });
      expect(await rulesOf(trx, org)).toEqual([]);
    });
  });

  test("8 an actor that is no user id is recorded in the audit row, and `ended_by` stays empty", async () => {
    await withRollback(db, async (trx) => {
      const org = await suggestOrg(trx);
      const id = await insertSuggestion(trx, org, { value: "anna@acme.pl", kind: "vip" });
      expect(await acceptSuggestion(deps(trx), org.ctx, { id, actor: "cli", via: "cli" })).toBe("accepted");
      expect((await rowOf(trx, id)).ended_by).toBeNull();
      expect((await auditOf(trx, org, auditEvents.suggestionAccepted))[0]?.actor).toBe("cli");
    });
  });

  test("9 a mailbox that is not active (paused, auth_error, host_blocked) answers not_found to Accept and to Dismiss; the row stays open", async () => {
    for (const status of ["paused", "auth_error", "host_blocked"] as const) {
      await withRollback(db, async (trx) => {
        const org = await suggestOrg(trx);
        const id = await insertSuggestion(trx, org, { value: "anna@acme.pl", kind: "vip" });
        await trx.updateTable("mailboxes").set({ status }).where("id", "=", org.mailboxId).execute();
        expect(await acceptSuggestion(deps(trx), org.ctx, cmd(org, id))).toBe("not_found");
        expect(await rowOf(trx, id)).toMatchObject({ status: "open", pattern: "anna@acme.pl" });
        expect(await rulesOf(trx, org)).toEqual([]);
        // Dismiss answers as Accept does: the frozen mailbox has no current suggestions, and the row stays open.
        expect(await dismissSuggestion(deps(trx), org.ctx, cmd(org, id))).toBe("not_found");
        expect(await rowOf(trx, id)).toMatchObject({ status: "open", pattern: "anna@acme.pl" });
        expect(await auditOf(trx, org, auditEvents.suggestionDismissed)).toEqual([]);
      });
    }
  });

  test("10 with the flag sender_suggestions off (or sender_context off) both commands answer not_found and change nothing", async () => {
    await withRollback(db, async (trx) => {
      const org = await suggestOrg(trx);
      const id = await insertSuggestion(trx, org, { value: "anna@acme.pl", kind: "vip" });
      await setOrgFeature(trx, org.ctx, { flag: "sender_suggestions", enabled: false, actor: "cli", now: NOW });
      expect(await acceptSuggestion(deps(trx), org.ctx, cmd(org, id))).toBe("not_found");
      expect(await dismissSuggestion(deps(trx), org.ctx, cmd(org, id))).toBe("not_found");
      await setOrgFeature(trx, org.ctx, { flag: "sender_suggestions", enabled: true, actor: "cli", now: NOW });
      await setOrgFeature(trx, org.ctx, { flag: "sender_context", enabled: false, actor: "cli", now: NOW });
      expect(await acceptSuggestion(deps(trx), org.ctx, cmd(org, id))).toBe("not_found");
      expect(await rowOf(trx, id)).toMatchObject({ status: "open" });
      expect(await rulesOf(trx, org)).toEqual([]);
    });
  });
});

describe("dismissSuggestion", () => {
  test("5a Dismiss ends the row as dismissed with no pattern and writes one audit row without an address", async () => {
    await withRollback(db, async (trx) => {
      const org = await suggestOrg(trx);
      const id = await insertSuggestion(trx, org, { value: "anna@acme.pl", kind: "whitelist" });
      expect(await dismissSuggestion(deps(trx), org.ctx, cmd(org, id))).toBe("dismissed");
      expect(await rowOf(trx, id)).toMatchObject({ status: "dismissed", pattern: null, ended_by: org.userId });
      const audit = await auditOf(trx, org, auditEvents.suggestionDismissed);
      expect(audit).toHaveLength(1);
      expect(audit[0]?.data).toEqual({ mailbox_id: org.mailboxId, kind: "whitelist", scope: "address", via: "web" });
      expect(JSON.stringify(audit)).not.toContain("@");
      expect(await rulesOf(trx, org)).toEqual([]);
    });
  });
});

// Committed data for two connections.
async function committedOrg(): Promise<Seeded> {
  const world = await db.transaction().execute(async (trx) => {
    const org = await suggestOrg(trx);
    return org;
  });
  orgIds.push(world.ctx.orgId);
  userIds.push(world.userId);
  return world;
}

const lockWaiters = async (): Promise<number> => {
  const { rows } = await sql<{ n: string }>`
    SELECT count(*)::text AS n FROM pg_stat_activity
    WHERE wait_event_type = 'Lock' AND wait_event IN ('transactionid', 'tuple') AND datname = current_database()`.execute(
    db
  );
  return Number(rows[0]?.n);
};

describe("two taps at once", () => {
  test("5 a Dismiss that starts while an Accept holds the row waits for it, then answers already; one rule exists", async () => {
    const org = await committedOrg();
    const id = await insertSuggestion(db, org, { value: "anna@acme.pl", kind: "vip" });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate;
    });
    let held = false;
    const accepting = db.transaction().execute(async (trx) => {
      const out = await acceptSuggestion(deps(trx), org.ctx, cmd(org, id));
      held = true;
      await gate;
      return out;
    });
    await waitFor(() => held, "the accept holds the row");
    let dismissed = false;
    const dismissing = dismissSuggestion(deps(db), org.ctx, cmd(org, id)).then((out) => {
      dismissed = true;
      return out;
    });
    let waiting = false;
    for (let i = 0; i < 200 && !waiting && !dismissed; i += 1) {
      waiting = (await lockWaiters()) > 0;
      if (!waiting) await Bun.sleep(25);
    }
    expect(waiting).toBe(true);
    expect(dismissed).toBe(false);
    release();
    expect(await accepting).toBe("accepted");
    expect(await dismissing).toBe("already");
    expect((await rowOf(db, id)).status).toBe("accepted");
    expect(await rulesOf(db, org)).toHaveLength(1);
    expect(await auditOf(db, org, auditEvents.suggestionDismissed)).toEqual([]);
  });

  test("5b a Dismiss that holds the row first makes an Accept wait, then answer already; no rule exists", async () => {
    const org = await committedOrg();
    const id = await insertSuggestion(db, org, { value: "anna@acme.pl", kind: "vip" });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate;
    });
    let held = false;
    const dismissing = db.transaction().execute(async (trx) => {
      const out = await dismissSuggestion(deps(trx), org.ctx, cmd(org, id));
      held = true;
      await gate;
      return out;
    });
    await waitFor(() => held, "the dismiss holds the row");
    let accepted = false;
    const accepting = acceptSuggestion(deps(db), org.ctx, cmd(org, id)).then((out) => {
      accepted = true;
      return out;
    });
    let waiting = false;
    for (let i = 0; i < 200 && !waiting && !accepted; i += 1) {
      waiting = (await lockWaiters()) > 0;
      if (!waiting) await Bun.sleep(25);
    }
    expect(waiting).toBe(true);
    release();
    expect(await dismissing).toBe("dismissed");
    expect(await accepting).toBe("already");
    expect(await rulesOf(db, org)).toEqual([]);
  });

  test("5d a profile pass that wants to withdraw a row waits for a tap that holds it, and leaves the accepted row as it is", async () => {
    const org = await committedOrg();
    // The pass would withdraw this row (a VIP rule of the whole organization covers it), but the Accept comes first.
    await db
      .insertInto("sender_rules")
      .values({ org_id: org.ctx.orgId, mailbox_id: null, pattern: "anna@acme.pl", kind: "vip" })
      .execute();
    const id = await insertSuggestion(db, org, { value: "anna@acme.pl", kind: "vip" });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate;
    });
    let held = false;
    const accepting = db.transaction().execute(async (trx) => {
      const out = await acceptSuggestion(deps(trx), org.ctx, cmd(org, id));
      held = true;
      await gate;
      return out;
    });
    await waitFor(() => held, "the accept holds the row");
    let done = false;
    const pass = refreshMailboxProfiles({ db, credentialsKey: KEY, testMail: NO_TEST }, org.ctx, org.mailboxId, {
      now: NOW,
    }).then(() => {
      done = true;
    });
    let waiting = false;
    for (let i = 0; i < 200 && !waiting && !done; i += 1) {
      waiting = (await lockWaiters()) > 0;
      if (!waiting) await Bun.sleep(25);
    }
    expect(waiting).toBe(true);
    release();
    expect(await accepting).toBe("accepted");
    await pass;
    expect((await rowOf(db, id)).status).toBe("accepted");
  });

  test("5c ten pairs of taps at once: each row has one winner, and the rule count matches", async () => {
    const org = await committedOrg();
    const ids: string[] = [];
    for (let i = 0; i < 10; i += 1) {
      ids.push(await insertSuggestion(db, org, { value: `p${i}@acme.pl`, kind: "vip", createdAt: ago(2) }));
    }
    const outcomes = await Promise.all(
      ids.flatMap((id) => [
        acceptSuggestion(deps(db), org.ctx, cmd(org, id)),
        dismissSuggestion(deps(db), org.ctx, cmd(org, id)),
      ])
    );
    let accepted = 0;
    for (let i = 0; i < ids.length; i += 1) {
      const pair = [outcomes[2 * i], outcomes[2 * i + 1]];
      expect(pair.filter((out) => out === "already")).toHaveLength(1);
      const row = await rowOf(db, ids[i] ?? "");
      expect(pair as string[]).toContain(row.status);
      if (row.status === "accepted") accepted += 1;
    }
    expect(await rulesOf(db, org)).toHaveLength(accepted);
    expect(await auditOf(db, org, auditEvents.suggestionAccepted)).toHaveLength(accepted);
    expect(await auditOf(db, org, auditEvents.suggestionDismissed)).toHaveLength(ids.length - accepted);
  });
});

describe("listOpenSuggestions and countOpenSuggestions", () => {
  test("11 they return the open rows of the mailbox, newest first, with the reason; ended rows and other mailboxes stay out", async () => {
    await withRollback(db, async (trx) => {
      const org = await suggestOrg(trx);
      const other = await secondMailbox(trx, org);
      const first = await insertSuggestion(trx, org, { value: "a@acme.pl", kind: "vip", createdAt: ago(5) });
      const second = await insertSuggestion(trx, org, {
        value: "@corp.pl",
        scope: "domain",
        kind: "whitelist",
        createdAt: ago(3),
      });
      await insertSuggestion(trx, org, { value: "ended@acme.pl", kind: "vip", status: "dismissed" });
      await insertSuggestion(trx, org, { value: "x@acme.pl", kind: "vip", mailboxId: other.mailboxId });
      const items = await listOpenSuggestions(trx, org.ctx, org.mailboxId);
      expect(items.map((item) => item.id)).toEqual([second, first]);
      expect(items[1]).toMatchObject({
        kind: "vip",
        scope: "address",
        pattern: "a@acme.pl",
        reason: { received: 8, answered: 6 },
      });
      expect(items[1]?.createdAt.getTime()).toBe(ago(5).getTime());
      expect(await countOpenSuggestions(trx, org.ctx, org.mailboxId)).toBe(2);
      expect(await countOpenSuggestions(trx, org.ctx, other.mailboxId)).toBe(1);
    });
  });

  test("12 they are empty while the flag is off, for a mailbox that is not active, and for another organization", async () => {
    await withRollback(db, async (trx) => {
      const org = await suggestOrg(trx);
      const stranger = await suggestOrg(trx);
      await insertSuggestion(trx, org, { value: "a@acme.pl", kind: "vip" });
      expect(await countOpenSuggestions(trx, stranger.ctx, org.mailboxId)).toBe(0);
      for (const status of ["paused", "auth_error", "host_blocked"] as const) {
        await trx.updateTable("mailboxes").set({ status }).where("id", "=", org.mailboxId).execute();
        expect(await listOpenSuggestions(trx, org.ctx, org.mailboxId)).toEqual([]);
        expect(await countOpenSuggestions(trx, org.ctx, org.mailboxId)).toBe(0);
      }
      await trx.updateTable("mailboxes").set({ status: "active" }).where("id", "=", org.mailboxId).execute();
      expect(await countOpenSuggestions(trx, org.ctx, org.mailboxId)).toBe(1);
      await setOrgFeature(trx, org.ctx, { flag: "sender_suggestions", enabled: false, actor: "cli", now: NOW });
      expect(await listOpenSuggestions(trx, org.ctx, org.mailboxId)).toEqual([]);
      expect(await countOpenSuggestions(trx, org.ctx, org.mailboxId)).toBe(0);
    });
  });
});

// Accept re-checks the protections of the engine (a delegate, an answer, a Sent mail to the sender) at the time of the tap: a
// row made before the sender became protected ends as `withdrawn` and makes no rule.
describe("acceptSuggestion: the sender is protected now", () => {
  const SPAMMER = "spam@acme.pl";

  // An open blocklist row for the spammer with the activity behind it and Sent coverage.
  async function blocklistOrg(trx: Trx) {
    const org = await suggestOrg(trx);
    await withSentCoverage(trx, org);
    await seed(trx, org, SPAMMER, spamMails());
    const id = await insertSuggestion(trx, org, { value: SPAMMER, kind: "blocklist" });
    return { org, id };
  }

  async function expectWithdrawn(trx: Trx, org: Seeded, id: string) {
    const rulesBefore = await rulesOf(trx, org);
    expect(await acceptSuggestion(deps(trx), org.ctx, cmd(org, id))).toBe("not_available");
    expect(await rowOf(trx, id)).toMatchObject({ status: "withdrawn", pattern: null, ended_by: null });
    expect(await rulesOf(trx, org)).toEqual(rulesBefore);
    expect(await auditOf(trx, org, auditEvents.suggestionAccepted)).toEqual([]);
    expect(await acceptSuggestion(deps(trx), org.ctx, cmd(org, id))).toBe("already");
  }

  test("11 control: with no protection the blocklist row is accepted and the rule exists", async () => {
    await withRollback(db, async (trx) => {
      const { org, id } = await blocklistOrg(trx);
      expect(await acceptSuggestion(deps(trx), org.ctx, cmd(org, id))).toBe("accepted");
      expect((await rulesOf(trx, org)).map((rule) => `${rule.kind}:${rule.pattern}`)).toEqual([`blocklist:${SPAMMER}`]);
    });
  });

  test("12 an active delegate added after the row was made: Accept answers not_available, ends the row as withdrawn, no rule", async () => {
    await withRollback(db, async (trx) => {
      const { org, id } = await blocklistOrg(trx);
      await insertDelegate(trx, org.ctx, { email: SPAMMER });
      await expectWithdrawn(trx, org, id);
    });
  });

  test("13 an inactive delegate does not protect the sender", async () => {
    await withRollback(db, async (trx) => {
      const { org, id } = await blocklistOrg(trx);
      await insertDelegate(trx, org.ctx, { email: SPAMMER, active: false });
      expect(await acceptSuggestion(deps(trx), org.ctx, cmd(org, id))).toBe("accepted");
    });
  });

  test("14 a Sent mail to the sender after the row was made protects the sender", async () => {
    await withRollback(db, async (trx) => {
      const org = await suggestOrg(trx);
      await withSentCoverage(trx, org);
      await seed(trx, org, SPAMMER, spamMails(), [{ at: ago(1), to: [SPAMMER] }]);
      const id = await insertSuggestion(trx, org, { value: SPAMMER, kind: "blocklist" });
      await expectWithdrawn(trx, org, id);
    });
  });

  test("15 a VIP rule for the sender added after the row was made protects the sender", async () => {
    await withRollback(db, async (trx) => {
      const { org, id } = await blocklistOrg(trx);
      await insertSenderRule(trx, org.ctx, { mailboxId: org.mailboxId, pattern: SPAMMER, kind: "vip" });
      await expectWithdrawn(trx, org, id);
    });
  });

  test("16 a domain blocklist row: an active delegate on the domain protects it", async () => {
    await withRollback(db, async (trx) => {
      const org = await suggestOrg(trx);
      await withSentCoverage(trx, org);
      for (const address of ["x@acme.pl", "y@acme.pl"]) await seed(trx, org, address, spamMails());
      const id = await insertSuggestion(trx, org, { value: "@acme.pl", scope: "domain", kind: "blocklist" });
      await insertDelegate(trx, org.ctx, { email: "ola@acme.pl" });
      await expectWithdrawn(trx, org, id);
    });
  });

  test("17 a blocklist row whose Sent coverage is gone is not available", async () => {
    await withRollback(db, async (trx) => {
      const { org, id } = await blocklistOrg(trx);
      await trx
        .updateTable("mailbox_sent_sync")
        .set({ last_pass_at: ago(3) })
        .where("mailbox_id", "=", org.mailboxId)
        .execute();
      await expectWithdrawn(trx, org, id);
    });
  });
});
