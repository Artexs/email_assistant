import { randomUUID } from "node:crypto";
import { format } from "node:util";

import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import { setOrgFeature, setOrgPlan, updateOrganizationSettings } from "../../src/modules/tenancy";
import { setLogLevel } from "../../src/platform/log";

import { createOrgWithMailbox } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();
const NOW = new Date("2026-11-20T10:00:00Z");

afterAll(async () => {
  await db.destroy();
});

let lines: string[] = [];
let logSpy: ReturnType<typeof spyOn>;
let errorSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  lines = [];
  logSpy = spyOn(console, "log").mockImplementation((...args: unknown[]) => void lines.push(format(...args)));
  errorSpy = spyOn(console, "error").mockImplementation((...args: unknown[]) => void lines.push(format(...args)));
  setLogLevel("info");
});

afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
});

describe("organization change lines", () => {
  test("a changed time zone logs the organization and the actor, never the values", async () => {
    await withRollback(db, async (trx) => {
      const { orgId } = await createOrgWithMailbox(trx);
      const actor = randomUUID();

      await updateOrganizationSettings(trx, { orgId }, { timezone: "America/New_York" }, { actor, now: NOW });
      // The same values again change nothing and log nothing.
      await updateOrganizationSettings(trx, { orgId }, { timezone: "America/New_York" }, { actor, now: NOW });

      expect(lines).toEqual([`[tenancy] org_timezone_changed org_id=${orgId} actor=${actor}`]);
      expect(lines.join("\n")).not.toContain("New_York");
    });
  });

  test("a plan change logs both plan names and the actor; an unchanged plan logs nothing", async () => {
    await withRollback(db, async (trx) => {
      const { orgId } = await createOrgWithMailbox(trx);

      await setOrgPlan(trx, { orgId }, { plan: "suspended", actor: "cli", now: NOW }, {});
      await setOrgPlan(trx, { orgId }, { plan: "suspended", actor: "cli", now: NOW }, {});
      await setOrgPlan(trx, { orgId }, { plan: "active", actor: "e2e-seed", now: NOW }, {});

      expect(lines).toEqual([
        `[tenancy] org_plan_changed org_id=${orgId} from_plan=active to_plan=suspended actor=cli`,
        `[tenancy] org_plan_changed org_id=${orgId} from_plan=suspended to_plan=active actor=e2e-seed`,
      ]);
    });
  });

  test("a flag change logs the flag, the new value as a boolean and the actor", async () => {
    await withRollback(db, async (trx) => {
      const { orgId } = await createOrgWithMailbox(trx);
      const actor = randomUUID();

      await setOrgFeature(trx, { orgId }, { flag: "stats_page", enabled: true, actor, now: NOW });
      await setOrgFeature(trx, { orgId }, { flag: "stats_page", enabled: true, actor, now: NOW });
      await setOrgFeature(trx, { orgId }, { flag: "stats_page", enabled: false, actor: "cli", now: NOW });

      expect(lines).toEqual([
        `[tenancy] org_flag_changed org_id=${orgId} flag=stats_page enabled=true actor=${actor}`,
        `[tenancy] org_flag_changed org_id=${orgId} flag=stats_page enabled=false actor=cli`,
      ]);
    });
  });

  test("an actor that is free text is dropped and counted, never written", async () => {
    await withRollback(db, async (trx) => {
      const { orgId } = await createOrgWithMailbox(trx);

      await setOrgFeature(trx, { orgId }, { flag: "stats_page", enabled: true, actor: "owner@x.test", now: NOW });

      expect(lines).toEqual([
        `[tenancy] org_flag_changed org_id=${orgId} flag=stats_page enabled=true dropped_fields=1`,
      ]);
    });
  });
});
