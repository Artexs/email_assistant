import { describe, expect, test } from "bun:test";

import { barCategories, noGoBodySchema, sentSyncBodySchema, settingsViewSchema, urgencyBodySchema } from "./settings";

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
    urgencyProfile: null,
    sentSync: null,
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

  test("refuses a fixture without urgencyProfile; takes a profile", () => {
    const rest: Partial<ReturnType<typeof fixture>> = fixture();
    delete rest.urgencyProfile;
    expect(settingsViewSchema.safeParse(rest).success).toBe(false);
    const profile = { topics: [{ label: "a", keywords: [] }], deadlines: [] };
    expect(settingsViewSchema.safeParse({ ...fixture(), urgencyProfile: profile }).success).toBe(true);
  });
});

describe("sentSync in the settings view", () => {
  const full = {
    flagOn: true,
    enabled: true,
    folder: "Sent",
    firstPassDone: true,
    lastSentAt: "2026-11-20T10:00:00.000Z",
    storedCount: 12,
    errorCode: null,
  };

  test("takes null and a full object", () => {
    expect(settingsViewSchema.safeParse({ ...fixture(), sentSync: null }).success).toBe(true);
    expect(settingsViewSchema.safeParse({ ...fixture(), sentSync: full }).success).toBe(true);
    expect(settingsViewSchema.safeParse({ ...fixture(), sentSync: { ...full, errorCode: "failed" } }).success).toBe(
      true
    );
  });

  test("refuses an unknown error code and a missing field", () => {
    expect(settingsViewSchema.safeParse({ ...fixture(), sentSync: { ...full, errorCode: "other" } }).success).toBe(
      false
    );
    const rest: Partial<typeof full> = { ...full };
    delete rest.storedCount;
    expect(settingsViewSchema.safeParse({ ...fixture(), sentSync: rest }).success).toBe(false);
  });

  test("the body schema takes a boolean and refuses text", () => {
    expect(sentSyncBodySchema.safeParse({ enabled: true }).success).toBe(true);
    expect(sentSyncBodySchema.safeParse({ enabled: "yes" }).success).toBe(false);
  });
});

describe("urgencyBodySchema", () => {
  test("takes a profile, null and an empty profile (defaults fill the lists)", () => {
    expect(urgencyBodySchema.parse({ profile: null })).toEqual({ profile: null });
    expect(urgencyBodySchema.parse({ profile: {} })).toEqual({ profile: { topics: [], deadlines: [] } });
    expect(urgencyBodySchema.safeParse({ profile: { topics: [{ label: "a" }], deadlines: [] } }).success).toBe(true);
  });

  test("refuses 21 topics, a bad date and a missing profile", () => {
    const topics = Array.from({ length: 21 }, () => ({ label: "a", keywords: [] }));
    expect(urgencyBodySchema.safeParse({ profile: { topics, deadlines: [] } }).success).toBe(false);
    const deadlines = [{ label: "a", due: "soon" }];
    expect(urgencyBodySchema.safeParse({ profile: { topics: [], deadlines } }).success).toBe(false);
    expect(urgencyBodySchema.safeParse({}).success).toBe(false);
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
