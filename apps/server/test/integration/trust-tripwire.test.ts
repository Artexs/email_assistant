import { format } from "node:util";

import { MINUTE_MS } from "@ea/core";
import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test";

import { settingsDeps } from "../../src/composition";
import { setOrgFeature } from "../../src/modules/tenancy";
import { setCategoryAutoWithEvidence } from "../../src/modules/trust";
import { createDb } from "../../src/platform/db";
import { logFormatFromEnv, setLogFormat, setLogLevel } from "../../src/platform/log";

import { suspendOrg } from "./fixtures";
import { testDb } from "./helpers";
import { addMailbox } from "./trust-fixtures";
import {
  addCorrected,
  addCheck,
  addFailedCheck,
  addFeedback,
  addLaterResult,
  addMove,
  at,
  GO_GATE,
  NOW,
  pausedNotices,
  policyOf,
  tripAudit,
  tripsOf,
  tripwireOf,
  withTripBox,
} from "./trust-tripwire-helpers";

// The tripwire (ADR 0028): a granted category whose moves the user corrects is paused, once, with one notice per
// linked owner. Committed rows and a fixed clock (the grant is 2026-11-01T10:00Z, now is 2026-11-08T12:00Z).
const db = testDb();
const ownerUrl = process.env.MIGRATOR_DATABASE_URL;
if (!ownerUrl) throw new Error("MIGRATOR_DATABASE_URL is missing: the owner role runs the two-connection test");
const ownerDb = createDb(ownerUrl);

afterAll(async () => {
  await Promise.all([db.destroy(), ownerDb.destroy()]);
});

afterEach(() => {
  setLogLevel("info");
  setLogFormat(logFormatFromEnv(process.env));
});

const run = (over?: Parameters<typeof tripwireOf>[1]) => tripwireOf(db, over).run();

describe("corrections (D9)", () => {
  test("1. two undo corrections of applied moves after the grant: trip `corrections`, `auto` off, one notice per owner, audit row", async () => {
    await withTripBox(db, { grants: [{ category: "notification" }] }, async (box) => {
      await addCorrected(db, box, { category: "notification" }, { at: "2026-11-03T10:00:00Z" });
      await addCorrected(db, box, { category: "notification", status: "undone" }, { at: "2026-11-06T10:00:00Z" });
      await run();
      const trips = await tripsOf(db, box);
      expect(trips).toHaveLength(1);
      expect(trips[0]?.reason).toBe("corrections");
      expect(trips[0]?.granted_at.toISOString()).toBe("2026-11-01T10:00:00.000Z");
      expect(trips[0]?.counts).toEqual({ corrections: 2, important: 0 });
      expect(trips[0]?.cleared_at).toBeNull();
      expect((await policyOf(db, box)).notification?.auto).toBe(false);
      const notices = await pausedNotices(db, box);
      expect(notices.map((row) => row.user_id).sort()).toEqual([box.owner1, box.owner2].sort());
      expect(new Set(notices.map((row) => row.dedup_key))).toEqual(new Set([`autonomy_paused:${trips[0]?.id}`]));
      expect(notices.find((row) => row.user_id === box.owner2)?.locale).toBe("pl");
      expect(notices[0]?.view).toEqual({
        mailboxId: box.mailboxId,
        category: "notification",
        reason: "corrections",
        corrections: 2,
        settingsUrl: "https://app.example.test/settings",
      });
      const audit = await tripAudit(db, box);
      expect(audit).toHaveLength(1);
      expect(audit[0]?.actor).toBe("system");
      expect(audit[0]?.data).toMatchObject({
        field: "auto.notification",
        from: true,
        to: false,
        trip_reason: "corrections",
      });
      expect(audit[0]?.data.corrections).toBe(2);
    });
  });

  test("2. one correction with the true category needs_reply: trip `important_hidden`; urgent too", async () => {
    for (const trueCategory of ["needs_reply", "urgent"] as const) {
      await withTripBox(db, { grants: [{ category: "info" }] }, async (box) => {
        await addCorrected(db, box, { category: "info" }, { at: "2026-11-03T10:00:00Z", source: "web", trueCategory });
        await run();
        const trips = await tripsOf(db, box);
        expect(trips.map((trip) => trip.reason)).toEqual(["important_hidden"]);
        expect((await pausedNotices(db, box)).map((row) => row.user_id).sort()).toEqual(
          [box.owner1, box.owner2].sort()
        );
      });
    }
  });

  test("3. one correction with the true category info: no trip", async () => {
    await withTripBox(db, { grants: [{ category: "info" }] }, async (box) => {
      await addCorrected(db, box, { category: "info" }, { at: "2026-11-03T10:00:00Z", trueCategory: "info" });
      await run();
      expect(await tripsOf(db, box)).toHaveLength(0);
      expect((await policyOf(db, box)).info?.auto).toBe(true);
    });
  });

  test("4. two corrections, one made before the grant: no trip; a move applied before the grant does not count either", async () => {
    await withTripBox(db, { grants: [{ category: "info" }] }, async (box) => {
      await addCorrected(db, box, { category: "info" }, { at: "2026-11-03T10:00:00Z" });
      // The correction is older than the grant (the user fixed a move of an earlier setup).
      await addCorrected(
        db,
        box,
        { category: "info", appliedAt: "2026-10-29T10:00:00Z" },
        { at: "2026-10-30T10:00:00Z" }
      );
      await run();
      expect(await tripsOf(db, box)).toHaveLength(0);
    });
    await withTripBox(db, { grants: [{ category: "info" }] }, async (box) => {
      await addCorrected(db, box, { category: "info" }, { at: "2026-11-03T10:00:00Z" });
      // The move was applied before the grant; only the correction is after it.
      await addCorrected(
        db,
        box,
        { category: "info", appliedAt: "2026-10-31T10:00:00Z" },
        { at: "2026-11-04T10:00:00Z" }
      );
      await run();
      expect(await tripsOf(db, box)).toHaveLength(0);
    });
  });

  test("4b. a verdict given before the grant on a move that took effect after it does not count", async () => {
    await withTripBox(db, { grants: [{ category: "info", at: "2026-11-05T10:00:00.000Z" }] }, async (box) => {
      const move = { category: "info", appliedAt: "2026-11-06T09:00:00Z" } as const;
      await addCorrected(db, box, move, { at: "2026-11-07T10:00:00Z" });
      // Inside the 7 days, but before the grant.
      await addCorrected(db, box, move, { at: "2026-11-03T10:00:00Z" });
      await run();
      expect(await tripsOf(db, box)).toHaveLength(0);
    });
  });

  test("5. two corrections of one mail (Undo, then the pencil) count once: no trip", async () => {
    await withTripBox(db, { grants: [{ category: "info" }] }, async (box) => {
      const emailId = await addCorrected(db, box, { category: "info" }, { at: "2026-11-03T10:00:00Z", source: "undo" });
      await addFeedback(db, box, emailId, { at: "2026-11-03T10:05:00Z", source: "web", trueCategory: "notification" });
      await run();
      expect(await tripsOf(db, box)).toHaveLength(0);
      // A second mail makes two.
      await addCorrected(db, box, { category: "info" }, { at: "2026-11-04T10:00:00Z" });
      await run();
      expect((await tripsOf(db, box)).map((trip) => trip.reason)).toEqual(["corrections"]);
    });
  });

  test("5b. the Undo row has no category: an earlier pencil row that named needs_reply still makes the mail important", async () => {
    await withTripBox(db, { grants: [{ category: "info" }] }, async (box) => {
      const emailId = await addCorrected(
        db,
        box,
        { category: "info" },
        { at: "2026-11-03T10:00:00Z", source: "web", trueCategory: "needs_reply" }
      );
      await addFeedback(db, box, emailId, { at: "2026-11-03T10:05:00Z", source: "undo", trueCategory: null });
      await run();
      expect((await tripsOf(db, box)).map((trip) => trip.reason)).toEqual(["important_hidden"]);
    });
  });

  test("5c. a newer `right` verdict on a mail withdraws its correction", async () => {
    await withTripBox(db, { grants: [{ category: "info" }] }, async (box) => {
      const emailId = await addCorrected(db, box, { category: "info" }, { at: "2026-11-03T10:00:00Z" });
      await addFeedback(db, box, emailId, { at: "2026-11-03T11:00:00Z", verdict: "right", trueCategory: "info" });
      await addCorrected(db, box, { category: "info" }, { at: "2026-11-04T10:00:00Z" });
      await run();
      expect(await tripsOf(db, box)).toHaveLength(0);
    });
  });

  test("6. a correction of a move that was only logged (shadow) is not counted", async () => {
    await withTripBox(db, { grants: [{ category: "info" }] }, async (box) => {
      await addCorrected(db, box, { category: "info" }, { at: "2026-11-03T10:00:00Z" });
      await addCorrected(db, box, { category: "info", status: "logged" }, { at: "2026-11-04T10:00:00Z" });
      await run();
      expect(await tripsOf(db, box)).toHaveLength(0);
    });
  });

  test("6a. a move that did not take effect (ready, failed, expired) is not counted, whatever its time", async () => {
    await withTripBox(db, { grants: [{ category: "info" }] }, async (box) => {
      await addCorrected(db, box, { category: "info" }, { at: "2026-11-03T10:00:00Z" });
      for (const status of ["ready", "failed", "expired"] as const) {
        await addCorrected(db, box, { category: "info", status }, { at: "2026-11-04T10:00:00Z" });
      }
      await run();
      expect(await tripsOf(db, box)).toHaveLength(0);
    });
  });

  test("6b. corrections of the moves of other categories do not add up; each category counts for itself", async () => {
    await withTripBox(db, { grants: [{ category: "info" }, { category: "spam" }] }, async (box) => {
      await addCorrected(db, box, { category: "info" }, { at: "2026-11-03T10:00:00Z" });
      await addCorrected(db, box, { category: "spam" }, { at: "2026-11-04T10:00:00Z" });
      await addCorrected(db, box, { category: "urgent" }, { at: "2026-11-05T10:00:00Z" });
      await run();
      expect(await tripsOf(db, box)).toHaveLength(0);
      await addCorrected(db, box, { category: "spam" }, { at: "2026-11-06T10:00:00Z" });
      await run();
      expect((await tripsOf(db, box)).map((trip) => trip.category)).toEqual(["spam"]);
      const policy = await policyOf(db, box);
      expect(policy.spam?.auto).toBe(false);
      expect(policy.info?.auto).toBe(true);
    });
  });

  test("6d. a correction in another mailbox of the organization is not counted for this mailbox", async () => {
    await withTripBox(db, { grants: [{ category: "info" }] }, async (box) => {
      const other = { ...box, mailboxId: await db.transaction().execute((trx) => addMailbox(trx, box)) };
      await addCorrected(db, box, { category: "info" }, { at: "2026-11-03T10:00:00Z" });
      await addCorrected(db, other, { category: "info" }, { at: "2026-11-04T10:00:00Z" });
      await run();
      expect(await tripsOf(db, box)).toHaveLength(0);
    });
  });

  test("6e. a move counts for the category of the result that planned it, not for a later result of the mail", async () => {
    await withTripBox(db, { grants: [{ category: "info" }] }, async (box) => {
      await addCorrected(db, box, { category: "info" }, { at: "2026-11-03T10:00:00Z" });
      const second = await addCorrected(db, box, { category: "info" }, { at: "2026-11-04T10:00:00Z" });
      await addLaterResult(db, box, second, "notification", "2026-11-05T10:00:00Z");
      await run();
      expect((await tripsOf(db, box)).map((trip) => trip.category)).toEqual(["info"]);
    });
  });

  test("6c. corrections older than 7 days do not count; a verdict on test mail does not count", async () => {
    await withTripBox(db, { grants: [{ category: "info" }] }, async (box) => {
      // After the grant, but 7 days and one hour before now: out of the window.
      await addCorrected(
        db,
        box,
        { category: "info", appliedAt: "2026-11-01T10:30:00Z" },
        { at: "2026-11-01T11:00:00Z" }
      );
      await addCorrected(db, box, { category: "info" }, { at: "2026-11-07T10:00:00Z" });
      await run();
      expect(await tripsOf(db, box)).toHaveLength(0);
    });
    await withTripBox(db, { grants: [{ category: "info" }] }, async (box) => {
      await addCorrected(db, box, { category: "info" }, { at: "2026-11-03T10:00:00Z" });
      await addCorrected(db, box, { category: "info", from: "tester@x.test" }, { at: "2026-11-04T10:00:00Z" });
      await tripwireOf(db, { testMail: { senders: ["tester@x.test"] } }).run();
      expect(await tripsOf(db, box)).toHaveLength(0);
    });
  });
});

describe("scope", () => {
  test("8. flag off, a shadow mailbox, a suspended organization, a legacy `auto` with no grant and `auto` off: no trip", async () => {
    const corrections = async (box: Parameters<typeof addCorrected>[1]) => {
      await addCorrected(db, box, { category: "info" }, { at: "2026-11-03T10:00:00Z" });
      await addCorrected(db, box, { category: "info" }, { at: "2026-11-04T10:00:00Z" });
    };
    await withTripBox(db, { grants: [{ category: "info" }], flag: false }, async (box) => {
      await corrections(box);
      await run();
      expect(await tripsOf(db, box)).toHaveLength(0);
      expect((await policyOf(db, box)).info?.auto).toBe(true);
      // The flag on again: the next run trips.
      await setOrgFeature(db, box, { flag: "trust_ladder", enabled: true, actor: box.owner1, now: NOW });
      await run();
      expect(await tripsOf(db, box)).toHaveLength(1);
    });
    await withTripBox(db, { grants: [{ category: "info" }], mode: "shadow" }, async (box) => {
      await corrections(box);
      await run();
      expect(await tripsOf(db, box)).toHaveLength(0);
    });
    await withTripBox(db, { grants: [{ category: "info" }] }, async (box) => {
      await corrections(box);
      await db.transaction().execute((trx) => suspendOrg(trx, box.orgId));
      await run();
      expect(await tripsOf(db, box)).toHaveLength(0);
    });
    await withTripBox(db, { legacyAutoOn: ["info"] }, async (box) => {
      await corrections(box);
      await run();
      expect(await tripsOf(db, box)).toHaveLength(0);
      expect((await policyOf(db, box)).info?.auto).toBe(true);
    });
    await withTripBox(db, {}, async (box) => {
      await corrections(box);
      await run();
      expect(await tripsOf(db, box)).toHaveLength(0);
    });
  });

  test("two organizations trip on their own: each notice goes to its own owners only", async () => {
    await withTripBox(db, { grants: [{ category: "info" }] }, async (a) => {
      await withTripBox(db, { grants: [{ category: "info" }] }, async (b) => {
        for (const box of [a, b]) {
          await addCorrected(db, box, { category: "info" }, { at: "2026-11-03T10:00:00Z" });
          await addCorrected(db, box, { category: "info" }, { at: "2026-11-04T10:00:00Z" });
        }
        await run();
        for (const [box, other] of [
          [a, b],
          [b, a],
        ] as const) {
          expect(await tripsOf(db, box)).toHaveLength(1);
          const users = (await pausedNotices(db, box)).map((row) => row.user_id);
          expect(users.sort()).toEqual([box.owner1, box.owner2].sort());
          expect(users).not.toContain(other.owner1);
        }
      });
    });
  });
});

describe("exactly once", () => {
  test("7. two runs at once (app role, then the table owner): one trip row, one notice per owner", async () => {
    for (const conn of [db, ownerDb]) {
      await withTripBox(db, { grants: [{ category: "info" }] }, async (box) => {
        await addCorrected(db, box, { category: "info" }, { at: "2026-11-03T10:00:00Z" });
        await addCorrected(db, box, { category: "info" }, { at: "2026-11-04T10:00:00Z" });
        await Promise.all(Array.from({ length: 4 }, () => tripwireOf(conn).run()));
        expect(await tripsOf(db, box)).toHaveLength(1);
        expect(await pausedNotices(db, box)).toHaveLength(2);
        expect(await tripAudit(db, box)).toHaveLength(1);
        // A later run adds nothing.
        await run();
        expect(await tripsOf(db, box)).toHaveLength(1);
        expect(await pausedNotices(db, box)).toHaveLength(2);
      });
    }
  });

  test("9. the owner turns `auto` on again: the trip is cleared and the old corrections do not trip again", async () => {
    await withTripBox(db, { grants: [{ category: "info" }] }, async (box) => {
      await addCorrected(db, box, { category: "info" }, { at: "2026-11-03T10:00:00Z" });
      await addCorrected(db, box, { category: "info" }, { at: "2026-11-04T10:00:00Z" });
      await run();
      expect(await tripsOf(db, box)).toHaveLength(1);
      const later = new Date(NOW.getTime() + MINUTE_MS);
      const result = await setCategoryAutoWithEvidence(
        { settings: settingsDeps(db, () => later, GO_GATE), testMail: { senders: [] } },
        box,
        box.mailboxId,
        { category: "info", auto: true, force: false, actor: box.owner1 }
      );
      expect(result.kind).toBe("changed");
      const [trip] = await tripsOf(db, box);
      expect(trip?.cleared_at?.toISOString()).toBe(later.toISOString());
      expect((await policyOf(db, box)).info?.grant?.at).toBe(later.toISOString());
      await tripwireOf(db, {}, () => later).run();
      expect(await tripsOf(db, box)).toHaveLength(1);
      expect((await policyOf(db, box)).info?.auto).toBe(true);
      expect(await pausedNotices(db, box)).toHaveLength(2);
    });
  });

  test("10. old moves corrected after a new grant do not trip the new grant", async () => {
    await withTripBox(db, { grants: [{ category: "info" }] }, async (box) => {
      const first = await addMove(db, box, { category: "info", appliedAt: "2026-11-02T09:00:00Z" });
      const second = await addMove(db, box, { category: "info", appliedAt: "2026-11-03T09:00:00Z" });
      // The category trips on other corrections of G1, the owner grants again (G2 at 11-05), then corrects the old moves.
      await addCorrected(db, box, { category: "info" }, { at: "2026-11-03T10:00:00Z" });
      await addCorrected(db, box, { category: "info" }, { at: "2026-11-04T10:00:00Z" });
      await run();
      expect(await tripsOf(db, box)).toHaveLength(1);
      const g2 = new Date("2026-11-05T10:00:00Z");
      await setCategoryAutoWithEvidence(
        { settings: settingsDeps(db, () => g2, GO_GATE), testMail: { senders: [] } },
        box,
        box.mailboxId,
        { category: "info", auto: true, force: false, actor: box.owner1 }
      );
      await addFeedback(db, box, first, { at: "2026-11-06T10:00:00Z" });
      await addFeedback(db, box, second, { at: "2026-11-07T10:00:00Z" });
      await tripwireOf(db, {}, () => NOW).run();
      expect(await tripsOf(db, box)).toHaveLength(1);
      expect((await policyOf(db, box)).info?.auto).toBe(true);
    });
  });

  test("a user who turns `auto` off and on between the read and the write: the stale trip writes nothing", async () => {
    await withTripBox(db, { grants: [{ category: "info" }] }, async (box) => {
      await addCorrected(db, box, { category: "info" }, { at: "2026-11-03T10:00:00Z" });
      await addCorrected(db, box, { category: "info" }, { at: "2026-11-04T10:00:00Z" });
      const later = new Date(NOW.getTime() - MINUTE_MS);
      await tripwireOf(db, {
        hooks: {
          beforeTrip: async () => {
            const deps = { settings: settingsDeps(db, () => later, GO_GATE), testMail: { senders: [] } };
            for (const auto of [false, true]) {
              await setCategoryAutoWithEvidence(deps, box, box.mailboxId, {
                category: "info",
                auto,
                force: false,
                actor: box.owner1,
              });
            }
          },
        },
      }).run();
      expect(await tripsOf(db, box)).toHaveLength(0);
      expect(await pausedNotices(db, box)).toHaveLength(0);
      const policy = await policyOf(db, box);
      expect(policy.info?.auto).toBe(true);
      expect(policy.info?.grant?.at).toBe(later.toISOString());
    });
  });

  test("a trip that finds its grant already tripped adds nothing (the unique key)", async () => {
    await withTripBox(db, { grants: [{ category: "info" }] }, async (box) => {
      await db
        .insertInto("autonomy_trips")
        .values({
          org_id: box.orgId,
          mailbox_id: box.mailboxId,
          category: "info",
          granted_at: at("2026-11-01T10:00:00Z"),
          reason: "corrections",
          counts: "{}",
          cleared_at: NOW,
        })
        .execute();
      await addCorrected(db, box, { category: "info" }, { at: "2026-11-03T10:00:00Z" });
      await addCorrected(db, box, { category: "info" }, { at: "2026-11-04T10:00:00Z" });
      await run();
      expect(await tripsOf(db, box)).toHaveLength(1);
      expect((await policyOf(db, box)).info?.auto).toBe(true);
      expect(await pausedNotices(db, box)).toHaveLength(0);
    });
  });
});

describe("history fail", () => {
  test("11. a `fail` that ended after a regate grant pauses the category: trip `history_fail`, one notice; a forced grant is not paused", async () => {
    await withTripBox(
      db,
      {
        grants: [
          { category: "spam", by: "regate" },
          { category: "info", by: "forced" },
        ],
      },
      async (box) => {
        await addFailedCheck(db, box, "2026-11-01T12:00:00Z", ["spam", "info"]);
        await run();
        const trips = await tripsOf(db, box);
        expect(trips.map((trip) => [trip.category, trip.reason])).toEqual([["spam", "history_fail"]]);
        expect(trips[0]?.counts).toEqual({ acted: 12, moved: 3, total: 100 });
        const policy = await policyOf(db, box);
        expect(policy.spam?.auto).toBe(false);
        expect(policy.info?.auto).toBe(true);
        expect(await pausedNotices(db, box)).toHaveLength(2);
        expect((await pausedNotices(db, box))[0]?.view).toMatchObject({
          category: "spam",
          reason: "history_fail",
          corrections: 0,
        });
      }
    );
  });

  test("a `fail` that ended before the grant does not pause it; a `pass` or an inconclusive result does not either", async () => {
    await withTripBox(db, { grants: [{ category: "spam", by: "regate" }] }, async (box) => {
      await addFailedCheck(db, box, "2026-11-01T09:00:00Z", ["spam"]);
      await run();
      expect(await tripsOf(db, box)).toHaveLength(0);
    });
    await withTripBox(db, { grants: [{ category: "spam", by: "evidence" }] }, async (box) => {
      await addFailedCheck(db, box, "2026-11-01T12:00:00Z", ["info"]);
      await addFailedCheck(db, box, "2026-11-01T13:00:00Z", ["spam"], "pass");
      await run();
      expect(await tripsOf(db, box)).toHaveLength(0);
    });
    await withTripBox(db, { grants: [{ category: "spam", by: "evidence" }] }, async (box) => {
      await addFailedCheck(db, box, "2026-11-01T12:00:00Z", ["spam"], "inconclusive");
      await run();
      expect(await tripsOf(db, box)).toHaveLength(0);
    });
    // The result of the granted category decides, not the result of another category of the same check.
    await withTripBox(db, { grants: [{ category: "spam", by: "evidence" }] }, async (box) => {
      await addCheck(db, box, "2026-11-01T12:00:00Z", { info: "fail", notification: "fail", spam: "pass" });
      await run();
      expect(await tripsOf(db, box)).toHaveLength(0);
    });
    // The newest `done` check decides: an older `fail` does not pause a category that a newer check passed.
    await withTripBox(db, { grants: [{ category: "spam", by: "evidence" }] }, async (box) => {
      await addFailedCheck(db, box, "2026-11-01T12:00:00Z", ["spam"]);
      await addFailedCheck(db, box, "2026-11-02T12:00:00Z", ["spam"], "pass");
      await run();
      expect(await tripsOf(db, box)).toHaveLength(0);
    });
  });
});

describe("the log line", () => {
  test("a trip logs one info line with the mailbox, the category and the reason: no mail id, no address", async () => {
    await withTripBox(db, { grants: [{ category: "info" }] }, async (box) => {
      await addCorrected(db, box, { category: "info", from: "canary-sender@x.test" }, { at: "2026-11-03T10:00:00Z" });
      await addCorrected(db, box, { category: "info" }, { at: "2026-11-04T10:00:00Z" });
      const lines: string[] = [];
      const spy = spyOn(console, "log").mockImplementation((...args: unknown[]) => void lines.push(format(...args)));
      setLogFormat("json");
      setLogLevel("debug");
      try {
        await run();
      } finally {
        spy.mockRestore();
      }
      const entries = lines
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .filter((entry) => entry.mailbox_id === box.mailboxId);
      const tripped = entries.filter((entry) => entry.event === "autonomy_tripped");
      expect(tripped).toHaveLength(1);
      expect(tripped[0]).toMatchObject({ level: "info", org_id: box.orgId, category: "info", reason: "corrections" });
      expect(tripped[0]).not.toHaveProperty("email_id");
      for (const line of lines) expect(line).not.toContain("canary");
    });
  });
});
