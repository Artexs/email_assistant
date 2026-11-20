import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterAll, afterEach, describe, expect, test } from "bun:test";

import { setOrgFeature } from "../../src/modules/tenancy";
import { runningEvidenceKey } from "../../src/modules/triage";
import { llmRoleTable, loadConfig } from "../../src/platform/config";
import { statsWeekUsage } from "../../src/scripts/stats-week-args";

import { createOrgWithMailbox } from "./fixtures";
import { testDb } from "./helpers";
import { flagLoops, seedLoops } from "./loops-m2-fixtures";
import { WEEK, seedWeek, type SeededWeek } from "./metrics-fixtures";
import { insertCheckRow, insertTripRow } from "./trust-fixtures";

const db = testDb();
const repoRoot = resolve(import.meta.dir, "../../../..");
const script = resolve(import.meta.dir, "../../src/scripts/stats-week.ts");

let seeded: SeededWeek | null = null;

afterEach(async () => {
  if (seeded === null) return;
  const orgIds = [seeded.orgA.ctx.orgId, seeded.orgB.ctx.orgId];
  const owners = await db.selectFrom("memberships").select("user_id").where("org_id", "in", orgIds).execute();
  await db.deleteFrom("organizations").where("id", "in", orgIds).execute();
  await db
    .deleteFrom("users")
    .where(
      "id",
      "in",
      owners.map((row) => row.user_id)
    )
    .execute();
  seeded = null;
});

afterAll(async () => {
  await db.destroy();
});

async function run(args: string[], env: Record<string, string> = {}) {
  const proc = Bun.spawn(["bun", script, ...args], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const code = await proc.exited;
  return { code, stdout: await new Response(proc.stdout).text(), stderr: await new Response(proc.stderr).text() };
}

describe("stats:week CLI", () => {
  // The argument lists that fail the parse are rows of `parseStatsWeekArgs` in stats-week-args.test.ts. This case proves
  // the wiring: the script turns a usage error into the usage line on stderr and exit 2.
  test("an empty argument list prints the usage and exits 2", async () => {
    const result = await run([]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain(`[stats-week] usage: ${statsWeekUsage}`);
    expect(result.stdout).toBe("");
  });

  test("an unknown organization or a foreign mailbox exits 1", async () => {
    expect((await run(["--org-id", crypto.randomUUID(), "--week", WEEK])).code).toBe(1);
    seeded = await db.transaction().execute((trx) => seedWeek(trx));
    const foreign = await run([
      "--org-id",
      seeded.orgB.ctx.orgId,
      "--mailbox-id",
      seeded.orgA.mailboxId,
      "--week",
      WEEK,
    ]);
    expect(foreign.code).toBe(1);
    expect(foreign.stderr).toContain("[stats-week] not_found: no such mailbox");
  });

  test("a run against the seeded week prints one line per metric and no address, subject or mail id", async () => {
    seeded = await db.transaction().execute((trx) => seedWeek(trx));
    const { orgA } = seeded;
    const result = await run(["--org-id", orgA.ctx.orgId, "--week", WEEK]);
    expect(result.code).toBe(0);
    const lines = result.stdout.trim().split("\n");
    // The figures are bare lines (`raw`): no `[stats-week]` prefix, and nothing else on stdout.
    expect(lines.every((l) => /^[a-z0-9_]+ /.test(l))).toBe(true);
    expect(result.stdout.endsWith("\n")).toBe(true);
    expect(result.stderr).toBe("");
    expect(lines.find((l) => l.startsWith("m1_missed"))).toStartWith(
      "m1_missed 1 of 5 (lower bound) sample 0 of 1 labelled 1"
    );
    expect(lines).toContain(
      "m3_total 4 hidden 2 wrong_person 1 wrong_content 0 sent_mistake 1 not_needed 0 no_reason 1"
    );
    expect(lines.find((l) => l.startsWith("m4_handled"))).toStartWith("m4_handled 3 of 9");
    expect(lines.find((l) => l.startsWith("m5_urgent"))).toContain("p90_minutes 3");
    const m8 = lines.filter((l) => l.startsWith("m8 "));
    expect(m8).toHaveLength(5);
    expect(m8[0]).toStartWith(`m8 ${orgA.mailboxId} `);
    expect(m8.every((l) => l.endsWith(" precision - lower - no-go: too few"))).toBe(true);
    expect(m8.find((l) => l.includes(" notification "))).toContain(" auto no kept 0 ");
    expect(result.stdout).not.toContain("@");
    expect(result.stdout).not.toContain(orgA.ids.e1 as string);
  });

  // The gate file of the committed lab run, copied for the key that the script runs on. `info` is `go` there;
  // `spam` is `no-go`. `provisional` is a mark of the whole file.
  function gateDir(provisional: boolean): string {
    const dir = mkdtempSync(join(tmpdir(), "f110-s12-gate-"));
    const key = runningEvidenceKey(llmRoleTable(loadConfig()));
    const real = join(repoRoot, "evals/results/gate/classifier-classifier-v2-gpt-6-luna-none-lab-01-v1.json");
    const file = JSON.parse(readFileSync(real, "utf8")) as Record<string, unknown>;
    writeFileSync(
      join(dir, "classifier-cli.json"),
      JSON.stringify({
        ...file,
        provider: key.provider,
        model: key.model,
        reasoningEffort: key.reasoningEffort,
        promptVersion: key.promptVersion,
        endpoint: key.endpoint,
        host: key.host,
        provisional,
      })
    );
    return dir;
  }

  test("3. with trust_ladder on the M8 rows get one trust line per category; off, no such line", async () => {
    seeded = await db.transaction().execute((trx) => seedWeek(trx));
    const { orgA } = seeded;
    const dir = gateDir(false);
    const provisionalDir = gateDir(true);
    try {
      const off = await run(["--org-id", orgA.ctx.orgId, "--week", WEEK], { GATE_EVIDENCE_DIR: dir });
      expect(off.code).toBe(0);
      expect(off.stdout).not.toContain("m8_trust");

      await setOrgFeature(db, orgA.ctx, { flag: "trust_ladder", enabled: true, actor: "cli", now: new Date() });
      const result = { spam: { outcome: "fail", acted: 100, moved: 3, upper: 0.07, total: 300, wouldMove: 30 } };
      await db.transaction().execute(async (trx) => {
        await insertCheckRow(trx, orgA.ctx, orgA.mailboxId, {
          status: "done",
          result: JSON.stringify(result),
          finished_at: new Date(),
        });
        await insertTripRow(trx, orgA.ctx, orgA.mailboxId, { category: "notification", reason: "corrections" });
      });
      const on = await run(["--org-id", orgA.ctx.orgId, "--week", WEEK], { GATE_EVIDENCE_DIR: dir });
      expect(on.code).toBe(0);
      const trust = on.stdout.split("\n").filter((line) => line.startsWith("m8_trust "));
      expect(trust).toHaveLength(5);
      const of = (category: string) => trust.find((line) => line.includes(` ${category} global `));
      expect(of("spam")).toEndWith("global no-go · history fail (3/100) · trip none");
      expect(of("info")).toEndWith("global go · history none · trip none");
      expect(of("notification")).toEndWith("global no-go · history none · trip corrections");
      // Counts and codes only: no address, subject or mail id.
      expect(on.stdout).not.toContain("@");

      // A provisional gate file marks the global evidence.
      const marked = await run(["--org-id", orgA.ctx.orgId, "--week", WEEK], { GATE_EVIDENCE_DIR: provisionalDir });
      expect(marked.stdout).toContain(" info global go provisional · history none · trip none");
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(provisionalDir, { recursive: true, force: true });
    }
  });

  // The script reads the clock, so the loops are due in a week that is long past: January 2026 (Warsaw, UTC+1).
  const PAST_WEEK = "2026-01-05";
  const PAST_DUE = new Date("2026-01-07T09:00:00Z");
  async function pastOrg(flagOn: boolean) {
    const org = await db.transaction().execute(async (trx) => {
      const made = await createOrgWithMailbox(trx);
      const org = { ctx: { orgId: made.orgId }, mailboxId: made.mailboxId, ownerId: made.userId, ids: {} };
      if (flagOn) await flagLoops(trx, org, true);
      await seedLoops(trx, org, PAST_DUE);
      return org;
    });
    seeded = { orgA: org, orgB: { ctx: org.ctx, mailboxId: org.mailboxId } };
    return org;
  }

  test("T9. with the flag open_loops on it prints one m2 line per kind, with the totals of the loops and no address", async () => {
    const org = await pastOrg(true);
    const result = await run(["--org-id", org.ctx.orgId, "--week", PAST_WEEK]);
    expect(result.code).toBe(0);
    const lines = result.stdout.trim().split("\n");
    expect(lines).toContain("m2_delegation due 0 closed 0 surfaced 0 pending 0");
    expect(lines).toContain("m2_waiting due 2 closed 1 surfaced 1 pending 0");
    expect(lines).toContain("m2_promised due 1 closed 0 surfaced 1 pending 0");
    expect(lines).toContain("m2_delegated due 1 closed 1 surfaced 1 pending 0");
    expect(lines.find((l) => l.startsWith("m2_open_loops"))).toBe(
      "m2_open_loops due 4 closed_on_time 2 of 4 (50%) surfaced_on_time 3 of 4 (75%) pending 0"
    );
    expect(result.stdout).not.toContain("@");
  });

  test("T10. with the flag off it prints the m2 total only and no loop line", async () => {
    const org = await pastOrg(false);
    const result = await run(["--org-id", org.ctx.orgId, "--week", PAST_WEEK]);
    expect(result.code).toBe(0);
    const m2 = result.stdout.split("\n").filter((line) => line.startsWith("m2_"));
    expect(m2).toEqual(["m2_open_loops due 0 closed_on_time 0 of 0 (-) surfaced_on_time 0 of 0 (-) pending 0"]);
  });
});
