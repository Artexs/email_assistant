import { describe, expect, test } from "bun:test";

import { miniScenario, miniSentSlot, sentFixtureText, sentPlantedFixture } from "./fixtures";
import type { SentSlot } from "./sent-slot";

const enFirst20 = "Hello, this is the note that we send to you, and we can write it for the team, please let";
const enFirst8 = "Hello, this is the note that we send";
const plFirst20 =
  "Dzień dobry, to jest bardzo ważne, ale nie mam czasu, więc proszę o pomoc i dziękuję za wszystko. Dzień dobry,";
const plFirst8 = "Dzień dobry, to jest bardzo ważne, ale nie";

const slotWith = (over: Partial<SentSlot>, style: Partial<SentSlot["style"]> = {}): SentSlot => ({
  ...miniSentSlot,
  ...over,
  style: { ...miniSentSlot.style, ...style },
});

describe("sentFixtureText", () => {
  test("a short quoted slot with a signature has the filler, the signature, then one block per thread mail", () => {
    const slot = slotWith({
      thread: [
        { from: "client-a", subject: "Oferty", brief: "the first mail" },
        { from: "kasia", subject: "Re: Oferty", brief: "the second mail" },
      ],
    });
    expect(sentFixtureText(slot)).toStrictEqual({
      id: "s-0001",
      subject: "Temat s-0001",
      body: [
        enFirst20,
        "Pozdrawiam, Szef",
        "",
        "On day 0, client-a wrote:",
        `> ${enFirst8}`,
        "",
        "On day 1, kasia wrote:",
        `> ${enFirst8}`,
      ].join("\n"),
    });
  });

  test("a Polish slot with no signature has the Polish filler and no signature line", () => {
    expect(sentFixtureText(slotWith({ lang: "pl" }, { signature: false })).body).toBe(
      [plFirst20, "", "On day 0, client-a wrote:", `> ${plFirst8}`].join("\n")
    );
  });

  test("a slot with a signature and an executive with an empty signature has no signature line", () => {
    const scenario = { ...miniScenario, executive: { ...miniScenario.executive, signature: "" } };
    expect(sentFixtureText(slotWith({}), scenario).body).toBe(
      [enFirst20, "", "On day 0, client-a wrote:", `> ${enFirst8}`].join("\n")
    );
  });

  test("a slot that is not quoted has no quoted block", () => {
    expect(sentFixtureText(slotWith({ quoted: false })).body).toBe([enFirst20, "Pozdrawiam, Szef"].join("\n"));
  });

  test("an injection slot plants the fixture string in the first block only and lists it", () => {
    const slot = slotWith({
      hardCases: ["injection_quote"],
      thread: [
        { from: "client-a", subject: "Oferty", brief: "the first mail" },
        { from: "kasia", subject: "Re: Oferty", brief: "the second mail" },
      ],
    });
    const text = sentFixtureText(slot);
    expect(sentPlantedFixture).toBe("PL00-TEST-4821");
    expect(text.planted).toEqual(["PL00-TEST-4821"]);
    expect(text.body.split("\n").filter((line) => line.startsWith("> "))).toEqual([
      "> PL00-TEST-4821",
      `> ${enFirst8}`,
    ]);
  });

  test("a slot with no hard case has no planted list", () => {
    expect(Object.keys(sentFixtureText(slotWith({})))).toEqual(["id", "subject", "body"]);
  });

  test.each([
    ["short", 20],
    ["medium", 100],
    ["long", 220],
  ] as const)("a %s text with no signature and no quote has %i words", (length, words) => {
    const text = sentFixtureText(slotWith({ quoted: false }, { length, signature: false }));
    expect(text.body.split(" ")).toHaveLength(words);
  });
});
