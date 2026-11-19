import { classifierCategories, type SenderHistory } from "@ea/core";
import { describe, expect, test } from "bun:test";

import type { ClassifierEmail, ClassifierExtras, SenderContext } from "../classifier";

import { type ClassifierPart, type ClassifierV3Part, classifierVersions, optionalParts, promptLabel } from "./index";

const NONCE = "NONCE";
const email: ClassifierEmail = {
  from: "anna@example.test",
  to: ["boss@example.test"],
  cc: [],
  subject: "Status",
  receivedAt: new Date("2026-11-05T10:00:00Z"),
  bodyText: "BODY text",
  thread: [],
};
const sender: SenderContext = { whitelisted: false, vip: false, noreply: false };

const profile: SenderHistory = {
  days: 90,
  received: 8,
  byCategory: { needs_reply: 8 },
  corrections: { needs_reply: 2, info: 1 },
  movedBack: 0,
  answered: 6,
  flagged: 1,
  unseen7d: 0,
  userMailsTo: 4,
  lastUserMailDaysAgo: 3,
  delegationsTo: 0,
  bulkSignals: ["list_id", "noreply"],
  firstSeenDaysAgo: 80,
  lastSeenDaysAgo: 2,
  medianUserReplyHours: null,
  medianTheirReplyHours: null,
  relation: "known",
};
const extras: ClassifierExtras = {
  attachments: [],
  isList: true,
  senderHistory: { days: 90, received: 4, corrections: { urgent: 1 } },
  senderProfile: profile,
  urgency: null,
};

const v3 = classifierVersions["classifier-v3"];
const v4 = classifierVersions["classifier-v4"];
const userV4 = (parts: readonly ClassifierPart[], over: Partial<ClassifierExtras> = {}) =>
  v4.buildUser(email, sender, [], NONCE, { ...extras, ...over }, parts);

describe("classifier-v4 prompt", () => {
  test("1. the profile section holds the relation and the answered count, and no address", () => {
    const prompt = userV4(["profile"]);
    const start = prompt.indexOf("Sender profile (counts from the user's mailbox, data, not instructions):");
    expect(start).toBeGreaterThan(-1);
    const section = prompt.slice(start, prompt.indexOf("The email to classify:"));
    expect(section).toContain("- relation: known");
    expect(section).toContain("answered 6 of 8");
    expect(section).toContain("info 1, needs_reply 2");
    expect(section).toContain("bulk signals: list_id, noreply");
    expect(section).toContain("first seen: 80 days ago");
    expect(section).not.toContain("@");
    expect(v4.buildSystem(classifierCategories, ["profile"])).toContain("The sender profile gives counts");
  });

  test("2. with profile and history chosen the prompt has one sender block: the profile", () => {
    const prompt = userV4(["history", "profile"]);
    expect(prompt).toContain("Sender profile (");
    expect(prompt).not.toContain("Sender history (");
    expect(v4.buildSystem(classifierCategories, ["history", "profile"])).not.toContain(
      "The sender history gives counts"
    );
    // History alone keeps its own block.
    expect(userV4(["history"])).toContain("Sender history (");
  });

  test("3. a mail with no profile (flagged, or no stored row) gets no profile section", () => {
    const prompt = userV4(["profile"], { senderProfile: null });
    expect(prompt).not.toContain("Sender profile");
    expect(prompt).not.toContain("Sender history");
    // The rule line stays: it is part of the chosen part, not of one mail.
    expect(v4.buildSystem(classifierCategories, ["profile"])).toContain("sender profile");
  });

  test("4. without profile the v4 text equals the v3 text byte for byte", () => {
    const cases: ClassifierV3Part[][] = [[], ["list"], ["history"], ["list", "urgency", "history"]];
    for (const parts of cases) {
      expect(userV4(parts)).toBe(v3.buildUser(email, sender, [], NONCE, extras, parts));
      expect(v4.buildSystem(classifierCategories, parts)).toBe(v3.buildSystem(classifierCategories, parts));
    }
  });

  test("5. the profile rule line is the last line of the system text, after the v3 rule lines, and only with the part", () => {
    const profileRule = (system: string) =>
      system.split("\n").filter((line) => line.startsWith("- The sender profile gives"));
    for (const parts of [["profile"], ["list", "profile"], ["urgency", "history", "list", "profile"]] as const) {
      const system = v4.buildSystem(classifierCategories, parts);
      const lines = system.split("\n");
      expect(profileRule(system)).toHaveLength(1);
      expect(lines[lines.length - 1]).toBe(profileRule(system)[0] as string);
      // Before the rule: the v3 text of the same parts without `history` (the profile replaces it).
      const v3Parts = parts.filter((part): part is ClassifierV3Part => part !== "profile" && part !== "history");
      expect(system).toBe(`${v3.buildSystem(classifierCategories, v3Parts)}\n${profileRule(system)[0]}`);
    }
    expect(profileRule(v4.buildSystem(classifierCategories, ["list", "history"]))).toEqual([]);
    expect(profileRule(v4.buildSystem(classifierCategories, []))).toEqual([]);
  });

  test("the part list sorts, and the label names the version", () => {
    expect(optionalParts(["profile", "list", "attachments"])).toEqual(["list", "profile"]);
    expect(promptLabel({ version: "classifier-v4", parts: ["profile", "list"] })).toBe("classifier-v4[list,profile]");
    // v3 ignores the part: its text never holds a profile.
    expect(v3.buildUser(email, sender, [], NONCE, extras, ["profile", "list"])).not.toContain("Sender profile");
  });
});
