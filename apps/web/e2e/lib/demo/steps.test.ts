import { describe, expect, test } from "bun:test";

import { publicContentScan } from "@ea/core/web";

import { cutPlan } from "./encode";
import { DEMO_STEPS, stepView, toVtt } from "./steps";

const SOURCES = ["e2e", "demo"] as const;

describe("toVtt", () => {
  test("writes the header, then one cue per step with its caption", () => {
    const vtt = toVtt(
      [
        { stepId: "connect", startMs: 0, endMs: 10000 },
        { stepId: "shadow", startMs: 10000, endMs: 25000 },
      ],
      "en",
      "e2e"
    );
    const [connect, shadow] = [DEMO_STEPS[0], DEMO_STEPS[1]];
    expect(vtt).toBe(
      `WEBVTT\n\n00:00:00.000 --> 00:00:10.000\n${connect?.caption.e2e.en}\n\n00:00:10.000 --> 00:00:25.000\n${shadow?.caption.e2e.en}\n`
    );
  });

  test("writes the demo captions of the cut cues for the demo source", () => {
    const cut = cutPlan([
      { stepId: "connect", startMs: 1000, endMs: 15000 },
      { stepId: "shadow", startMs: 15200, endMs: 27000 },
      { stepId: "report", startMs: 90000, endMs: 108000 },
    ]).cues;
    const vtt = toVtt(cut, "pl", "demo");
    const captions = DEMO_STEPS.slice(0, 3).map((step) => step.caption.demo.pl);
    expect(vtt).toBe(
      `WEBVTT\n\n00:00:00.000 --> 00:00:14.000\n${captions[0]}\n\n00:00:14.200 --> 00:00:26.000\n${captions[1]}\n\n00:00:26.000 --> 00:00:44.000\n${captions[2]}\n`
    );
  });

  test("uses the Polish caption for pl and writes hours, minutes and milliseconds", () => {
    const vtt = toVtt([{ stepId: "undo", startMs: 3_723_004, endMs: 3_725_000 }], "pl", "e2e");
    expect(vtt).toContain("01:02:03.004 --> 01:02:05.000");
    expect(vtt).toContain(DEMO_STEPS.find((step) => step.id === "undo")?.caption.e2e.pl ?? "missing");
  });

  test("keeps the input order", () => {
    const vtt = toVtt(
      [
        { stepId: "undo", startMs: 0, endMs: 1000 },
        { stepId: "connect", startMs: 1000, endMs: 2000 },
      ],
      "en",
      "demo"
    );
    expect(vtt.indexOf("00:00:00.000")).toBeLessThan(vtt.indexOf("00:00:01.000"));
    expect(vtt.indexOf(DEMO_STEPS[7]?.caption.demo.en ?? "missing")).toBeLessThan(
      vtt.indexOf(DEMO_STEPS[0]?.caption.demo.en ?? "missing")
    );
  });

  test("throws on a cue that ends when it starts or before", () => {
    expect(() => toVtt([{ stepId: "connect", startMs: 5000, endMs: 5000 }], "en", "e2e")).toThrow("vtt_empty_cue");
    expect(() => toVtt([{ stepId: "connect", startMs: 5000, endMs: 4000 }], "en", "e2e")).toThrow("vtt_empty_cue");
  });

  test("throws on a negative or fractional time", () => {
    expect(() => toVtt([{ stepId: "connect", startMs: -1, endMs: 1000 }], "en", "e2e")).toThrow("vtt_bad_time");
    expect(() => toVtt([{ stepId: "connect", startMs: 0, endMs: 1000.5 }], "en", "e2e")).toThrow("vtt_bad_time");
  });

  test("throws on an unknown step id", () => {
    expect(() => toVtt([{ stepId: "nope", startMs: 0, endMs: 1000 }], "en", "e2e")).toThrow("vtt_unknown_step");
  });
});

describe("stepView", () => {
  test.each([
    { source: "e2e" as const, notLive: ["shadow", "report", "urgent"] as string[] },
    { source: "demo" as const, notLive: [] as string[] },
  ])("lists the not-live steps of the $source source", ({ source, notLive }) => {
    expect(
      DEMO_STEPS.map((step) => stepView(step, source))
        .filter((view) => !view.live)
        .map((view) => view.id)
    ).toEqual(notLive);
  });

  test("gives the id, the planned seconds and the caption of the source", () => {
    const step = DEMO_STEPS[1];
    if (step === undefined) throw new Error("missing step");
    expect(stepView(step, "demo")).toEqual({ id: "shadow", seconds: 12, live: true, caption: step.caption.demo });
    expect(stepView(step, "e2e")).toEqual({ id: "shadow", seconds: 12, live: false, caption: step.caption.e2e });
  });
});

describe("captions", () => {
  test("the e2e caption of the report step is the two exact texts", () => {
    expect(DEMO_STEPS.find((step) => step.id === "report")?.caption.e2e).toEqual({
      en: "Day 3: what it would have done.\nEvery move is a plan, with its evidence.",
      pl: "Dzień 3: co zrobiłby asystent.\nKażdy ruch to plan, z dowodami.",
    });
  });

  const cases = DEMO_STEPS.flatMap((step) =>
    SOURCES.flatMap((source) =>
      (["en", "pl"] as const).map((lang) => ({ id: step.id, source, lang, text: step.caption[source][lang] }))
    )
  );

  test.each(cases)("the $source $lang caption of $id has no first person", ({ text }) => {
    expect(text).not.toMatch(/(^|[^\p{L}])(I would|bym|I)([^\p{L}]|$)/u);
  });
});

describe.each(SOURCES)("DEMO_STEPS of the %s source", (source) => {
  const views = DEMO_STEPS.map((step) => stepView(step, source));

  test("has 8 unique ids and plans 105 to 125 seconds", () => {
    expect(views).toHaveLength(8);
    expect(new Set(views.map((view) => view.id)).size).toBe(8);
    const total = views.reduce((sum, view) => sum + view.seconds, 0);
    expect(total).toBeGreaterThanOrEqual(105);
    expect(total).toBeLessThanOrEqual(125);
  });

  test("has a caption of one or two lines in en and pl, and names the day only of a step that is not live", () => {
    for (const view of views) {
      for (const lang of ["en", "pl"] as const) {
        const text = view.caption[lang];
        expect(text.trim()).not.toBe("");
        expect(text.split("\n").length).toBeLessThanOrEqual(2);
      }
      expect(/^Day \d+:/.test(view.caption.en)).toBe(!view.live);
      expect(/^Dzień \d+:/.test(view.caption.pl)).toBe(!view.live);
    }
  });

  test("has captions that pass the public content scan", () => {
    for (const view of views) {
      for (const lang of ["en", "pl"] as const) {
        expect(publicContentScan(view.caption[lang], []).problems).toEqual([]);
      }
    }
  });
});
