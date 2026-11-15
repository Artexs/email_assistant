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

  test("the hash does not depend on the order of the slots", () => {
    const two = input();
    const second: SentSlot = { ...miniSentSlot, id: "s-0003" };
    two.slots["sent-dev"] = [second, miniSentSlot];
    two.texts["sent-dev"] = new Map([
      ["s-0003", { ...miniSentText, id: "s-0003" }],
      ["s-0001", miniSentText],
    ]);
    const reversed = { ...two, slots: { ...two.slots, "sent-dev": [miniSentSlot, second] } };
    expect(sentManifestBody(two).parts["sent-dev"]).toEqual(sentManifestBody(reversed).parts["sent-dev"]);
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
