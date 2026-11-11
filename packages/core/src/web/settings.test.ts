import { describe, expect, test } from "bun:test";

import { barCategories, noGoBodySchema, settingsViewSchema } from "./settings";

const gate = { decision: "go", precision: 0.99, kept: 40, atConfidence: 0.8, threshold: 0.8 } as const;

function fixture() {
  return {
    mailboxId: "11111111-1111-4111-8111-111111111111",
    mode: "assist",
    toolSwitches: { move: true, mark_read: true, flag: true, create_draft: false, move_unsure: false },
    movesSupported: true,
    categories: barCategories.map((category) => ({ category, auto: false, threshold: 0.7, gate })),
    syncFolders: [
      { key: "inbox", role: "inbox", path: "INBOX", enabled: true },
      { key: "junk", role: "junk", path: "Junk", enabled: false },
    ],
    bar: 0.98,
    minKept: 30,
  };
}

describe("settingsViewSchema", () => {
  test("parses a full fixture", () => {
    expect(settingsViewSchema.safeParse(fixture()).success).toBe(true);
  });

  test("refuses a fixture without create_draft", () => {
    const toolSwitches: Partial<ReturnType<typeof fixture>["toolSwitches"]> = { ...fixture().toolSwitches };
    delete toolSwitches.create_draft;
    expect(settingsViewSchema.safeParse({ ...fixture(), toolSwitches }).success).toBe(false);
  });
});

describe("noGoBodySchema", () => {
  test("parses a too-few gate", () => {
    const body = {
      error: "no_go",
      gate: { decision: "no-go: too few", precision: null, kept: 12, atConfidence: 0.5, threshold: null },
    };
    expect(noGoBodySchema.safeParse(body).success).toBe(true);
  });
});
