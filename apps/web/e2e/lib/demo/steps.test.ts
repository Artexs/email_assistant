import { describe, expect, test } from "bun:test";

import { publicContentScan } from "@ea/core/web";

import { DEMO_STEPS, toVtt } from "./steps";

describe("toVtt", () => {
  test("writes the header, then one cue per step with its caption", () => {
    const vtt = toVtt(
      [
        { stepId: "connect", startMs: 0, endMs: 10000 },
        { stepId: "shadow", startMs: 10000, endMs: 25000 },
      ],
      "en"
    );
    const [connect, shadow] = [DEMO_STEPS[0], DEMO_STEPS[1]];
    expect(vtt).toBe(
      `WEBVTT\n\n00:00:00.000 --> 00:00:10.000\n${connect?.caption.en}\n\n00:00:10.000 --> 00:00:25.000\n${shadow?.caption.en}\n`
    );
  });

  test("uses the Polish caption for pl and writes hours, minutes and milliseconds", () => {
    const vtt = toVtt([{ stepId: "undo", startMs: 3_723_004, endMs: 3_725_000 }], "pl");
    expect(vtt).toContain("01:02:03.004 --> 01:02:05.000");
    expect(vtt).toContain(DEMO_STEPS.find((step) => step.id === "undo")?.caption.pl ?? "missing");
  });

  test("keeps the input order", () => {
    const vtt = toVtt(
      [
        { stepId: "undo", startMs: 0, endMs: 1000 },
        { stepId: "connect", startMs: 1000, endMs: 2000 },
      ],
      "en"
    );
    expect(vtt.indexOf("00:00:00.000")).toBeLessThan(vtt.indexOf("00:00:01.000"));
    expect(vtt.indexOf(DEMO_STEPS[7]?.caption.en ?? "missing")).toBeLessThan(
      vtt.indexOf(DEMO_STEPS[0]?.caption.en ?? "missing")
    );
  });

  test("throws on a cue that ends when it starts or before", () => {
    expect(() => toVtt([{ stepId: "connect", startMs: 5000, endMs: 5000 }], "en")).toThrow("vtt_empty_cue");
    expect(() => toVtt([{ stepId: "connect", startMs: 5000, endMs: 4000 }], "en")).toThrow("vtt_empty_cue");
  });

  test("throws on a negative or fractional time", () => {
    expect(() => toVtt([{ stepId: "connect", startMs: -1, endMs: 1000 }], "en")).toThrow("vtt_bad_time");
    expect(() => toVtt([{ stepId: "connect", startMs: 0, endMs: 1000.5 }], "en")).toThrow("vtt_bad_time");
  });

  test("throws on an unknown step id", () => {
    expect(() => toVtt([{ stepId: "nope", startMs: 0, endMs: 1000 }], "en")).toThrow("vtt_unknown_step");
  });
});

describe("DEMO_STEPS", () => {
  test("has 8 unique ids and plans 105 to 125 seconds", () => {
    expect(DEMO_STEPS).toHaveLength(8);
    expect(new Set(DEMO_STEPS.map((step) => step.id)).size).toBe(8);
    const total = DEMO_STEPS.reduce((sum, step) => sum + step.seconds, 0);
    expect(total).toBeGreaterThanOrEqual(105);
    expect(total).toBeLessThanOrEqual(125);
  });

  test("has a caption of one or two lines in en and pl, and names the day of a step that is not live", () => {
    for (const step of DEMO_STEPS) {
      for (const lang of ["en", "pl"] as const) {
        const text = step.caption[lang];
        expect(text.trim()).not.toBe("");
        expect(text.split("\n").length).toBeLessThanOrEqual(2);
      }
      if (!step.live) {
        expect(step.caption.en).toMatch(/^Day \d+:/);
        expect(step.caption.pl).toMatch(/^Dzień \d+:/);
      }
    }
  });

  test("has captions that pass the public content scan", () => {
    for (const step of DEMO_STEPS) {
      for (const lang of ["en", "pl"] as const) {
        expect(publicContentScan(step.caption[lang], []).problems).toEqual([]);
      }
    }
  });
});
