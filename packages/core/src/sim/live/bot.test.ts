import { describe, expect, test } from "bun:test";

import { localDateTime } from "../../digest/local-time";

import {
  backOnText,
  botReplyPlan,
  botReplyText,
  botSeed,
  otherAddressOf,
  workStartAfter,
  type BotReplyPlanInput,
  type DelegateBehaviour,
} from "./bot";
import { parseLabMessageId } from "./message";

// Warsaw wall time of an instant, "YYYY-MM-DD HH:MM".
function warsaw(iso: string): string {
  const local = localDateTime(new Date(iso), "Europe/Warsaw");
  return `${local.date} ${local.time}`;
}

// November 2026: Warsaw is UTC+1, so 10:00 Warsaw is 09:00Z.
const MON_10 = "2026-11-23T09:00:00.000Z";
const FRI_17_50 = "2026-11-27T16:50:00.000Z";
const FRI_18_30 = "2026-11-27T17:30:00.000Z";
const SAT_03 = "2026-11-28T02:00:00.000Z";

function plan(behaviour: DelegateBehaviour, input: Partial<BotReplyPlanInput> = {}) {
  return botReplyPlan({
    behaviour,
    event: "delegation",
    receivedAt: MON_10,
    repliedBefore: false,
    seed: 7,
    ...input,
  });
}

describe("bot reply plan", () => {
  test("1: done on a Monday 10:00 answers the same day between 10:30 and 14:00", () => {
    for (let seed = 0; seed < 200; seed += 1) {
      const reply = plan("done", { seed });
      expect(reply?.kind).toBe("done");
      expect(reply?.from).toBe("self");
      const at = warsaw(reply?.at ?? "");
      expect(at >= "2026-11-23 10:30" && at <= "2026-11-23 14:00").toBe(true);
    }
  });

  test("2: done on Friday 17:50 may fall after 18:00; at Friday 18:30 it moves to Monday morning", () => {
    for (let seed = 0; seed < 200; seed += 1) {
      const evening = warsaw(plan("done", { receivedAt: FRI_17_50, seed })?.at ?? "");
      expect(evening >= "2026-11-27 18:20" && evening <= "2026-11-27 21:50").toBe(true);
      const late = warsaw(plan("done", { receivedAt: FRI_18_30, seed })?.at ?? "");
      expect(late >= "2026-11-30 08:30" && late <= "2026-11-30 12:00").toBe(true);
    }
  });

  test("2b: the start point on a weekend, before 08:00 and at 18:00 sharp", () => {
    expect(warsaw(workStartAfter(SAT_03).toISOString())).toBe("2026-11-30 08:00");
    expect(warsaw(workStartAfter("2026-11-24T05:00:00.000Z").toISOString())).toBe("2026-11-24 08:00");
    expect(warsaw(workStartAfter("2026-11-24T17:00:00.000Z").toISOString())).toBe("2026-11-25 08:00");
    expect(warsaw(workStartAfter("2026-11-24T07:00:00.000Z").toISOString())).toBe("2026-11-24 08:00");
  });

  test("the same seed gives the same time, another seed can differ", () => {
    expect(plan("done", { seed: 3 })).toEqual(plan("done", { seed: 3 }));
    const times = new Set(Array.from({ length: 30 }, (_, seed) => plan("done", { seed })?.at));
    expect(times.size).toBeGreaterThan(5);
  });

  test("3: late — delegation null, first reminder done after 30 to 120 minutes, later reminders null", () => {
    expect(plan("late")).toBeNull();
    for (let seed = 0; seed < 100; seed += 1) {
      const reply = plan("late", { event: "reminder", seed });
      expect(reply?.kind).toBe("done");
      const at = warsaw(reply?.at ?? "");
      expect(at >= "2026-11-23 10:30" && at <= "2026-11-23 12:00").toBe(true);
    }
    expect(plan("late", { event: "reminder", repliedBefore: true })).toBeNull();
  });

  test("done and other_address ignore a reminder", () => {
    expect(plan("done", { event: "reminder" })).toBeNull();
    expect(plan("other_address", { event: "reminder" })).toBeNull();
  });

  test("other_address answers like done, from the other address", () => {
    const reply = plan("other_address", { seed: 5 });
    expect(reply?.from).toBe("other");
    expect(reply?.at).toBe(plan("done", { seed: 5 })?.at as string);
  });

  test("4: out_of_office answers one minute after receipt at any hour, to both events", () => {
    for (const event of ["delegation", "reminder"] as const) {
      expect(plan("out_of_office", { receivedAt: SAT_03, event })).toEqual({
        kind: "auto_reply",
        from: "self",
        at: "2026-11-28T02:01:00.000Z",
      });
    }
  });

  test("5: silent never answers", () => {
    expect(plan("silent")).toBeNull();
    expect(plan("silent", { event: "reminder" })).toBeNull();
  });

  test("the start point after the spring clock change uses the new offset", () => {
    // Sunday 2027-03-28 is the spring change: on Monday Warsaw is UTC+2, so 08:00 is 06:00Z.
    expect(warsaw(workStartAfter("2027-03-28T10:00:00.000Z").toISOString())).toBe("2027-03-29 08:00");
  });
});

describe("bot texts", () => {
  test("the fixed templates, per language", () => {
    expect(botReplyText("done", "pl", "Dorota", "x").body).toBe("Zrobione. Pozdrawiam, Dorota");
    expect(botReplyText("done", "en", "Dorota", "x").body).toBe("Done. Best regards, Dorota");
    expect(botReplyText("done", "de", "Dorota", "x").body).toBe("Erledigt. Viele Grüße, Dorota");
    expect(botReplyText("auto_reply", "pl", "n", "30.11.2026").body).toBe(
      "Jestem poza biurem do 30.11.2026. Odpowiem po powrocie."
    );
    expect(botReplyText("auto_reply", "en", "n", "2026-11-30").body).toBe(
      "I am out of the office until 2026-11-30. I will answer when I am back."
    );
    expect(botReplyText("auto_reply", "de", "n", "30.11.2026").body).toBe(
      "Ich bin bis 30.11.2026 nicht im Büro. Ich antworte nach meiner Rückkehr."
    );
  });

  test("the back-on date is the receipt day in Warsaw plus 7 days", () => {
    expect(backOnText("2026-11-23T09:00:00.000Z", "pl")).toBe("30.11.2026");
    expect(backOnText("2026-11-23T09:00:00.000Z", "en")).toBe("2026-11-30");
    // 23:30 UTC is already the next day in Warsaw.
    expect(backOnText("2026-11-23T23:30:00.000Z", "de")).toBe("01.12.2026");
  });
});

describe("bot addresses and seed", () => {
  test("otherAddressOf keeps the local part on the private domain", () => {
    expect(otherAddressOf("dorota.wilczynska@kordelan.test")).toBe("dorota.wilczynska@poczta-prywatna.test");
  });

  test("the bot reply id <r.hex@domain> never parses as a lab id", () => {
    expect(parseLabMessageId("<r.0123456789ab@kordelan.test>")).toBeNull();
    expect(parseLabMessageId("r.0123456789ab@kordelan.test")).toBeNull();
    expect(parseLabMessageId("<w-1-001.week-20261123-abcd@kordelan.test>")).not.toBeNull();
  });

  test("botSeed depends on the run id and the Message-ID", () => {
    expect(botSeed("week-20261123-abcd", "<a@x>")).toBe(botSeed("week-20261123-abcd", "<a@x>"));
    expect(botSeed("week-20261123-abcd", "<a@x>")).not.toBe(botSeed("week-20261123-abce", "<a@x>"));
    expect(botSeed("week-20261123-abcd", "<a@x>")).not.toBe(botSeed("week-20261123-abcd", "<b@x>"));
  });
});
