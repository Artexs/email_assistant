import { DAY_MS, MINUTE_MS, STYLE_MAX_SOURCES } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { renderStyleReport, type SentBankMail, styleSourcesOf } from "./style-eval";

const NEWEST = Date.parse("2027-01-31T09:30:00.000Z");
const mail = (daysBack: number, body: string): SentBankMail => ({
  sentAt: new Date(NEWEST - daysBack * DAY_MS).toISOString(),
  body,
  to: [`${body}@example.test`],
  cc: [],
});

describe("styleSourcesOf", () => {
  test("keeps the mails up to exactly 14 days before the newest one", () => {
    const mails = [mail(20, "day0"), mail(15, "day5"), mail(14, "day6"), mail(10, "day10"), mail(0, "day20")];
    expect(styleSourcesOf(mails).map((source) => source.bodyText)).toEqual(["day20", "day10", "day6"]);
  });

  test("gives the newest first, with the addresses of the mail", () => {
    const sources = styleSourcesOf([{ ...mail(3, "older"), cc: ["cc@example.test"] }, mail(1, "newer")]);
    expect(sources).toEqual([
      { bodyText: "newer", toAddresses: ["newer@example.test"], ccAddresses: [] },
      { bodyText: "older", toAddresses: ["older@example.test"], ccAddresses: ["cc@example.test"] },
    ]);
  });

  test("keeps at most the newest STYLE_MAX_SOURCES mails", () => {
    const mails = Array.from({ length: STYLE_MAX_SOURCES + 20 }, (_, i) => ({
      ...mail(0, `m${i}`),
      sentAt: new Date(NEWEST - i * MINUTE_MS).toISOString(),
    }));
    const sources = styleSourcesOf(mails);
    expect(sources).toHaveLength(STYLE_MAX_SOURCES);
    expect(sources[0]?.bodyText).toBe("m0");
    expect(sources.at(-1)?.bodyText).toBe(`m${STYLE_MAX_SOURCES - 1}`);
  });

  test("a part with no mail has no source", () => {
    expect(styleSourcesOf([])).toEqual([]);
  });
});

describe("renderStyleReport", () => {
  const base = {
    title: "Stylist eval: sim lab-01 sent-dev",
    date: "2027-02-01",
    scenario: "lab-01",
    part: "sent-dev",
    provider: "openai",
    endpoint: "standard",
    host: null,
    model: "gpt-6-luna",
    reasoningEffort: "low",
    promptVersion: "stylist-v1",
    sourceCount: 40,
    sampleCount: 38,
    calls: 1,
    spentUsd: 0.0012,
    capUsd: 1,
  };

  test("holds the part, the counts, the version, the model, the effort, the checks, the cost and the style text", () => {
    const report = renderStyleReport({ ...base, checks: { ok: true, failures: [] }, text: "Short.\nDirect." });
    for (const line of [
      "- part: sent-dev",
      "- samples: 38",
      "- prompt version: stylist-v1",
      "- model: gpt-6-luna",
      "- reasoning effort: low",
      "- checks: ok",
      "- cost: $0.0012 of cap $1.0000",
      "> Short.\n> Direct.",
    ]) {
      expect(report).toContain(line);
    }
  });

  test("names the failed checks and marks a missing text", () => {
    const report = renderStyleReport({ ...base, checks: { ok: false, failures: ["phone", "name"] }, text: "" });
    expect(report).toContain("- checks: failed (phone, name)");
    expect(report).toContain("(no text)");
  });
});
