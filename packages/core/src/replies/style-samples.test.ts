import { describe, expect, test } from "bun:test";

import { buildStyleSamples, STYLE_SAMPLE_MAX_CHARS, STYLE_SAMPLES_MAX_CHARS, styleNameTokens } from "./style-samples";
import type { StyleSource } from "./style-samples";

const source = (bodyText: string, to: string[] = [], cc: string[] = []): StyleSource => ({
  bodyText,
  toAddresses: to,
  ccAddresses: cc,
});

describe("buildStyleSamples", () => {
  test("drops a text that is only a quote", () => {
    const result = buildStyleSamples(
      [source("One."), source("> only a quote"), source("Two.\n\nOn Tue, Anna wrote:\n> x")],
      { signature: null }
    );
    expect(result.samples).toEqual(["One.", "Two."]);
  });

  test("cuts a long text to the sample limit", () => {
    const result = buildStyleSamples([source("a".repeat(2000))], { signature: null });
    expect(result.samples.map((sample) => sample.length)).toEqual([STYLE_SAMPLE_MAX_CHARS]);
  });

  test("stops before the total limit", () => {
    const sources = Array.from({ length: 50 }, () => source("b".repeat(1500)));
    const { samples } = buildStyleSamples(sources, { signature: null });
    expect(samples).toHaveLength(STYLE_SAMPLES_MAX_CHARS / STYLE_SAMPLE_MAX_CHARS);
  });

  test("keeps the input order and removes the signature", () => {
    const { samples } = buildStyleSamples([source("First\n\nWiktor"), source("Second\n\nWiktor")], {
      signature: "Wiktor",
    });
    expect(samples).toEqual(["First", "Second"]);
  });

  test("takes the names from the recipients and from the samples that it kept", () => {
    const { names } = buildStyleSamples(
      [source("Dear Karin,\n\nThanks.\n\nWiktor Szalewski", ["karin.lindqvist@x.test"])],
      { signature: "Wiktor Szalewski" }
    );
    expect(names).toEqual(["karin", "lindqvist"]);
  });
});

describe("styleNameTokens", () => {
  test("takes the pieces of the local part and the name after a greeting", () => {
    expect(styleNameTokens([source("Dear Karin,\n\nThanks.", ["karin.lindqvist@x.test"])])).toEqual([
      "karin",
      "lindqvist",
    ]);
  });

  test.each([
    ["ab@x.test", []],
    ["a_b-c+dan@x.test", ["dan"]],
  ])("the local part of %s", (address, expected) => {
    expect(styleNameTokens([source("", [address])])).toEqual(expected);
  });

  test("reads the Cc addresses too", () => {
    expect(styleNameTokens([source("", [], ["marek.nowak@x.test"])])).toEqual(["marek", "nowak"]);
  });

  test("takes capitalised words in mid-sentence, not sentence starts and not the stop list", () => {
    const text = "Thanks. I met Halina in Gdańsk on Monday. Pan Jan agreed.";
    expect(styleNameTokens([source(text)])).toEqual(["gdańsk", "halina", "jan"]);
  });

  test("skips acronyms and words that start a line", () => {
    expect(styleNameTokens([source("Send the PDF to OK Corp.\nMarek will call")])).toEqual(["corp"]);
  });

  test("takes the name after a greeting word, not a lower-case word", () => {
    expect(styleNameTokens([source("Cześć Marek,\nWitam serdecznie")])).toEqual(["marek"]);
  });

  test("ignores a quoted reply", () => {
    expect(styleNameTokens([source("Ok.\n\nOn Tue, Anna Nowak wrote:\n> Hi Zofia")])).toEqual([]);
  });
});
