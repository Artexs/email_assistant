import { describe, expect, test } from "bun:test";

import { miniScenario, miniSentBlind, miniSentLabel, miniSentSlot, miniSentText } from "./fixtures";
import { sentBlindHash, sentBlindOf, sentExpectedOf, sentLabelDisagreements } from "./sent-blind";
import { sentBlindCaseSchema } from "./sent-slot";

const zone = "Europe/Warsaw";

describe("sentBlindOf", () => {
  test("T5 the blind view holds the mail as a mail, with no labels and no slot field", () => {
    const entry = sentBlindOf(miniSentSlot, miniSentText, miniScenario);
    expect(entry).toEqual({
      ...miniSentBlind,
      from: "Szef Mini <szef@mini.test>",
    });
    expect(sentBlindCaseSchema.parse(entry)).toEqual(entry);
    const json = JSON.stringify(entry);
    for (const word of ["labels", "ask", "promise", "hardCases", "brief", "style", "persona"]) {
      expect(json).not.toContain(`"${word}"`);
    }
    // The brief of the writer never reaches the checker.
    expect(json).not.toContain("Mail to Persona");
  });

  test("an unknown recipient key throws", () => {
    expect(() => sentBlindOf({ ...miniSentSlot, to: ["nobody"] }, miniSentText, miniScenario)).toThrow(
      "unknown persona"
    );
  });

  test("the hash follows the text and nothing else", () => {
    const entry = sentBlindOf(miniSentSlot, miniSentText, miniScenario);
    expect(sentBlindHash(entry)).toMatch(/^[0-9a-f]{64}$/);
    expect(sentBlindHash(entry)).toBe(sentBlindHash(sentBlindOf(miniSentSlot, miniSentText, miniScenario)));
    const rewritten = sentBlindOf(
      miniSentSlot,
      { ...miniSentText, body: `${miniSentText.body} Thanks.` },
      miniScenario
    );
    expect(sentBlindHash(rewritten)).not.toBe(sentBlindHash(entry));
    // A change of the slot label does not touch the blind view.
    const relabelled = {
      ...miniSentSlot,
      labels: { ...miniSentSlot.labels, expectsReply: false, ask: null, due: null },
    };
    expect(sentBlindHash(sentBlindOf(relabelled, miniSentText, miniScenario))).toBe(sentBlindHash(entry));
  });
});

describe("slot label and checker label", () => {
  test("a due reference becomes the local day it resolves to", () => {
    // Sent Wed 2026-11-18 10:00 Warsaw: friday → 2026-11-20; the date stays.
    expect(sentExpectedOf(miniSentSlot, zone)).toEqual({
      expectsReply: true,
      promise: true,
      due: "2026-11-20",
      promiseDue: "2026-11-25",
    });
    const late = { ...miniSentSlot, sentAt: "2026-11-20T18:00:00.000Z" };
    // Sent Fri 19:00 local: end_of_week is the next Friday; friday is the next Friday too.
    const endOfWeek = {
      ...late,
      labels: { ...late.labels, due: { kind: "word" as const, word: "end_of_week" as const } },
    };
    expect(sentExpectedOf(endOfWeek, zone).due).toBe("2026-11-27");
  });

  test("T7 the fields in which the labels differ", () => {
    const expected = sentExpectedOf(miniSentSlot, zone);
    expect(sentLabelDisagreements(expected, miniSentLabel)).toEqual([]);
    expect(sentLabelDisagreements(expected, { ...miniSentLabel, due: "2026-11-21" })).toEqual(["due"]);
    expect(sentLabelDisagreements(expected, { ...miniSentLabel, due: null })).toEqual(["due"]);
    expect(sentLabelDisagreements(expected, { ...miniSentLabel, promiseDue: "2026-11-26" })).toEqual(["promiseDue"]);
    expect(
      sentLabelDisagreements(expected, {
        ...miniSentLabel,
        expectsReply: false,
        due: null,
        promise: false,
        promiseDue: null,
      })
    ).toEqual(["expectsReply", "promise", "due", "promiseDue"]);
  });

  test("null equals null", () => {
    const none = {
      ...miniSentSlot,
      labels: { expectsReply: false, ask: null, due: null, promise: null, promiseDue: null },
    };
    const label = { ...miniSentLabel, expectsReply: false, promise: false, due: null, promiseDue: null };
    expect(sentLabelDisagreements(sentExpectedOf(none, zone), label)).toEqual([]);
  });
});
