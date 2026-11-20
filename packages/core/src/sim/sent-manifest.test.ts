import { createHash } from "node:crypto";

import { describe, expect, test } from "bun:test";

import { miniScenario, miniSentBlind, miniSentLabel, miniSentSlot, miniSentText } from "./fixtures";
import { sentBlindHash } from "./sent-blind";
import {
  nextSentVersion,
  sentFreezeIssues,
  sentManifestBody,
  sentManifestSchema,
  sentPartHash,
  type SentFreezeInput,
} from "./sent-manifest";
import type { SentLabel, SentSlot, SentText } from "./sent-slot";

const floors = { minDev: 1, minHoldout: 1 };
const label: SentLabel = { ...miniSentLabel, blindHash: sentBlindHash(miniSentBlind) };

function input(patch: { label?: SentLabel | null } = {}): SentFreezeInput {
  const dev: SentSlot = miniSentSlot;
  const holdout: SentSlot = { ...miniSentSlot, id: "s-0002", part: "sent-holdout" };
  const text = (slot: SentSlot): SentText => ({ ...miniSentText, id: slot.id });
  const labels = (slot: SentSlot) => ({ ...label, id: slot.id });
  const devLabel = patch.label === undefined ? labels(dev) : patch.label;
  return {
    slots: { "sent-dev": [dev], "sent-holdout": [holdout] },
    texts: {
      "sent-dev": new Map([[dev.id, text(dev)]]),
      "sent-holdout": new Map([[holdout.id, text(holdout)]]),
    },
    labels: {
      "sent-dev": new Map(devLabel === null ? [] : [[dev.id, devLabel]]),
      "sent-holdout": new Map([[holdout.id, labels(holdout)]]),
    },
    planned: { "sent-dev": [dev.id], "sent-holdout": [holdout.id] },
    timeZone: miniScenario.executive.timeZone,
  };
}

describe("sentFreezeIssues", () => {
  test("T8 agreeing labels give no issue", () => {
    expect(sentFreezeIssues(input(), floors)).toEqual([]);
  });

  test("T7 one due disagreement gives label_disagrees with the field", () => {
    const issues = sentFreezeIssues(input({ label: { ...label, id: "s-0001", due: "2026-11-21" } }), floors);
    expect(issues).toContainEqual({ code: "label_disagrees", detail: "sent-dev s-0001 due" });
    expect(issues.map((issue) => issue.code)).toEqual(["label_disagrees", "too_few"]);
  });

  test("two disagreeing fields are listed in one issue, joined by a comma", () => {
    const issues = sentFreezeIssues(
      input({ label: { ...label, id: "s-0001", due: "2026-11-21", promiseDue: "2026-11-26" } }),
      { minDev: 0, minHoldout: 0 }
    );
    expect(issues).toEqual([{ code: "label_disagrees", detail: "sent-dev s-0001 due,promiseDue" }]);
  });

  test("a missing label is unlabelled; a missing text is unwritten", () => {
    expect(sentFreezeIssues(input({ label: null }), { minDev: 0, minHoldout: 0 })).toEqual([
      { code: "unlabelled", detail: "sent-dev s-0001" },
    ]);
    const unwritten = input();
    unwritten.texts["sent-dev"].clear();
    expect(sentFreezeIssues(unwritten, { minDev: 0, minHoldout: 0 })).toEqual([
      { code: "unwritten", detail: "sent-dev s-0001" },
    ]);
  });

  test("the floors count the cases with an agreeing label", () => {
    expect(sentFreezeIssues(input(), { minDev: 2, minHoldout: 1 })).toEqual([
      { code: "too_few", detail: "sent-dev 1|2" },
    ]);
    expect(sentFreezeIssues(input(), { minDev: 1, minHoldout: 2 })).toEqual([
      { code: "too_few", detail: "sent-holdout 1|2" },
    ]);
  });

  test("an issue holds no mail text", () => {
    expect(JSON.stringify(sentFreezeIssues(input({ label: null }), floors))).not.toContain("Friday");
  });
});

describe("sentManifestBody", () => {
  test("T8 part hashes follow slots and texts; a changed text changes only its part", () => {
    const a = sentManifestBody(input());
    expect(a.parts["sent-dev"]).toEqual({
      cases: 1,
      sha256: sentPartHash(input().slots["sent-dev"], input().texts["sent-dev"]),
    });
    expect(a.parts["sent-dev"].sha256).toMatch(/^[0-9a-f]{64}$/);
    const changed = input();
    changed.texts["sent-dev"].set("s-0001", { ...miniSentText, body: "other body" });
    const b = sentManifestBody(changed);
    expect(b.parts["sent-dev"].sha256).not.toBe(a.parts["sent-dev"].sha256);
    expect(b.parts["sent-holdout"]).toEqual(a.parts["sent-holdout"]);
  });

  test.each([
    ["a", "b", "c"],
    ["a", "c", "b"],
    ["b", "a", "c"],
    ["b", "c", "a"],
    ["c", "a", "b"],
    ["c", "b", "a"],
  ])("the hash of the slots in the order %s, %s, %s is the hash of the pairs sorted by id", (first, second, third) => {
    const order = [first, second, third];
    const slot = (key: string): SentSlot => ({ ...miniSentSlot, id: `s-${key}` });
    const text = (key: string): SentText => ({ ...miniSentText, id: `s-${key}`, body: `body ${key}` });
    const texts = new Map(["a", "b", "c"].map((key) => [`s-${key}`, text(key)]));
    const sorted = ["a", "b", "c"].map((key) => [slot(key), text(key)]);
    const expected = createHash("sha256").update(JSON.stringify(sorted)).digest("hex");
    expect(sentPartHash(order.map(slot), texts)).toBe(expected);
  });

  test("a slot with no text is left out of the hash, the count, and the hard-case count", () => {
    const body = input();
    body.slots["sent-dev"] = [miniSentSlot, { ...miniSentSlot, id: "s-0007", hardCases: ["thanks_only"] }];
    const result = sentManifestBody(body);
    const expected = createHash("sha256")
      .update(JSON.stringify([[miniSentSlot, miniSentText]]))
      .digest("hex");
    expect(result.parts["sent-dev"]).toEqual({ cases: 1, sha256: expected });
    expect(result.hardCases).toEqual({});
  });

  test("a planned id with no slot is dropped; hard cases are counted", () => {
    const body = input();
    body.planned["sent-holdout"] = ["s-0002", "s-0009", "s-0005"];
    body.slots["sent-dev"] = [{ ...miniSentSlot, hardCases: ["thanks_only"] }];
    const result = sentManifestBody(body);
    expect(result.dropped).toEqual({ "sent-dev": [], "sent-holdout": ["s-0005", "s-0009"] });
    expect(result.hardCases).toEqual({ thanks_only: 1 });
  });

  test("the schema accepts the body with a version and a date", () => {
    const manifest = { scenario: "mini", version: "sent-v1", frozenAt: "2026-11-15", ...sentManifestBody(input()) };
    expect(sentManifestSchema.parse(manifest)).toEqual(manifest);
    expect(sentManifestSchema.safeParse({ ...manifest, version: "1" }).success).toBe(false);
  });

  test("nextSentVersion", () => {
    expect(nextSentVersion("sent-v1")).toBe("sent-v2");
    expect(nextSentVersion("sent-v9")).toBe("sent-v10");
  });
});
