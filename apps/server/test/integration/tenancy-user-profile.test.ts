import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, test } from "bun:test";

import { createOrganizationWithOwner, getUserAuthProfile, insertUser, setUserTerms } from "../../src/modules/tenancy";

import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

describe("user auth profile", () => {
  test("a new user has an empty profile; an unknown id gives undefined", async () => {
    await withRollback(db, async (trx) => {
      const user = await insertUser(trx, { email: `u-${randomUUID()}@x.test`, displayName: "U" });
      expect(await getUserAuthProfile(trx, user.id)).toEqual({
        locale: null,
        termsVersion: null,
        termsAcceptedAt: null,
      });
      expect(await getUserAuthProfile(trx, randomUUID())).toBeUndefined();
    });
  });

  test("setUserTerms stores version and time; a stored version or an unknown id gives false", async () => {
    await withRollback(db, async (trx) => {
      const user = await insertUser(trx, { email: `u-${randomUUID()}@x.test`, displayName: "U" });
      const at = new Date("2026-11-20T10:00:00Z");
      expect(await setUserTerms(trx, user.id, "2026-11-12", at)).toBe(true);
      expect(await getUserAuthProfile(trx, user.id)).toEqual({
        locale: null,
        termsVersion: "2026-11-12",
        termsAcceptedAt: at,
      });
      expect(await setUserTerms(trx, user.id, "2026-11-12", new Date("2026-11-21T10:00:00Z"))).toBe(false);
      expect((await getUserAuthProfile(trx, user.id))?.termsAcceptedAt).toEqual(at);
      expect(await setUserTerms(trx, user.id, "2026-12-01", at)).toBe(true);
      expect(await setUserTerms(trx, randomUUID(), "2026-11-12", at)).toBe(false);
    });
  });

  test("createOrganizationWithOwner stores the locale; absent gives null", async () => {
    await withRollback(db, async (trx) => {
      const base = { orgName: "Org", timezone: "Europe/Warsaw", displayName: "Owner" };
      const en = await createOrganizationWithOwner(trx, { ...base, email: `en-${randomUUID()}@x.test`, locale: "en" });
      const none = await createOrganizationWithOwner(trx, { ...base, email: `none-${randomUUID()}@x.test` });
      expect((await getUserAuthProfile(trx, en.userId))?.locale).toBe("en");
      expect((await getUserAuthProfile(trx, none.userId))?.locale).toBeNull();
    });
  });
});
