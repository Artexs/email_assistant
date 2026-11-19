import { describe, expect, test } from "bun:test";

import {
  type FeatureFlag,
  expiredFlags,
  featureEpicPattern,
  featureFlags,
  featureKeyPattern,
  featureKeys,
  isFeatureKey,
  resolveFeature,
} from "./features";

describe("featureFlags registry", () => {
  test("every flag has a valid key, description, epic and remove-by date", () => {
    for (const [key, flag] of Object.entries<FeatureFlag>(featureFlags)) {
      expect(key).toMatch(featureKeyPattern);
      expect(flag.description.length).toBeGreaterThan(0);
      expect(flag.description).toBe(flag.description.trim());
      expect(flag.epic).toMatch(featureEpicPattern);
      expect(flag.removeBy).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(new Date(`${flag.removeBy}T00:00:00Z`).toISOString().slice(0, 10)).toBe(flag.removeBy);
    }
  });

  test("the mailbox OAuth flags default off, epic E9a, remove by 2027-06-01", () => {
    for (const key of ["mail_oauth_microsoft", "mail_oauth_google"] as const) {
      expect(featureFlags[key].default).toBe(false);
      expect(featureFlags[key].epic).toBe("E9a");
      expect(featureFlags[key].removeBy).toBe("2027-06-01");
    }
    expect(featureFlags.mail_oauth_microsoft.description).toBe(
      "Connect a Microsoft 365 or Outlook mailbox with Microsoft sign-in."
    );
    expect(featureFlags.mail_oauth_google.description).toBe("Connect a Gmail mailbox with Google sign-in.");
  });

  test("the epic pattern accepts every epic code form and refuses the rest", () => {
    for (const ok of ["E3a", "E4-A", "E5a", "E7-T2", "E8-LR", "E11b", "E7i"]) {
      expect(featureEpicPattern.test(ok)).toBe(true);
    }
    for (const bad of ["E", "e3a", "E3-a", "E123"]) {
      expect(featureEpicPattern.test(bad)).toBe(false);
    }
  });

  test("the placeholder flags exist and default off", () => {
    expect(featureFlags.stats_page.default).toBe(false);
    expect(featureFlags.approvals_page.default).toBe(false);
    expect(featureFlags.delegation_pages.default).toBe(false);
    expect(featureFlags.sent_sync.default).toBe(false);
  });

  test("reply_drafts exists, defaults off, epic E6a, remove by 2027-06-01", () => {
    expect(featureFlags.reply_drafts.default).toBe(false);
    expect(featureFlags.reply_drafts.epic).toBe("E6a");
    expect(featureFlags.reply_drafts.removeBy).toBe("2027-06-01");
  });

  test("web_push exists, defaults off, epic E9, remove by 2027-06-01", () => {
    expect(featureFlags.web_push.default).toBe(false);
    expect(featureFlags.web_push.epic).toBe("E9");
    expect(featureFlags.web_push.removeBy).toBe("2027-06-01");
  });

  test("telegram_minimal exists, defaults off, epic E9, remove by 2027-06-01, after web_push", () => {
    expect(featureFlags.telegram_minimal.default).toBe(false);
    expect(featureFlags.telegram_minimal.epic).toBe("E9");
    expect(featureFlags.telegram_minimal.removeBy).toBe("2027-06-01");
    expect(featureKeys.indexOf("telegram_minimal")).toBe(featureKeys.indexOf("web_push") + 1);
  });

  test("draft_copy_check exists, defaults off, epic E6a, remove by 2027-06-01", () => {
    expect(featureFlags.draft_copy_check.default).toBe(false);
    expect(featureFlags.draft_copy_check.epic).toBe("E6a");
    expect(featureFlags.draft_copy_check.removeBy).toBe("2027-06-01");
  });

  test("sender_context, contact_wait and sender_suggestions exist, default off, epic E11a, remove by 2027-06-01, in this order", () => {
    for (const key of ["sender_context", "contact_wait", "sender_suggestions"] as const) {
      expect({ key, default: featureFlags[key].default }).toEqual({ key, default: false });
      expect({ key, epic: featureFlags[key].epic }).toEqual({ key, epic: "E11a" });
      expect({ key, removeBy: featureFlags[key].removeBy }).toEqual({ key, removeBy: "2027-06-01" });
    }
    const keys = featureKeys.filter((key) => ["sender_context", "contact_wait", "sender_suggestions"].includes(key));
    expect(keys).toEqual(["sender_context", "contact_wait", "sender_suggestions"]);
  });

  test("security_log exists, defaults off and has the epic E7-T2 and remove-by 2027-03-01", () => {
    expect(featureFlags.security_log.default).toBe(false);
    expect(featureEpicPattern.test(featureFlags.security_log.epic)).toBe(true);
    expect(featureFlags.security_log.epic).toBe("E7-T2");
    expect(featureFlags.security_log.removeBy).toBe("2027-03-01");
  });

  test("mistake_capture defaults off and has the epic E3a", () => {
    expect(featureFlags.mistake_capture.default).toBe(false);
    expect(featureFlags.mistake_capture.epic).toBe("E3a");
    expect(featureEpicPattern.test(featureFlags.mistake_capture.epic)).toBe(true);
  });

  test("llm_pause_line defaults off and has the epic E3a", () => {
    expect(featureFlags.llm_pause_line.default).toBe(false);
    expect(featureFlags.llm_pause_line.epic).toBe("E3a");
    expect(featureFlags.llm_pause_line.removeBy).toBe("2027-03-01");
    expect(featureEpicPattern.test(featureFlags.llm_pause_line.epic)).toBe(true);
  });

  test("weekly_report and handled_share default off and have the epic E3a", () => {
    for (const key of ["weekly_report", "handled_share"] as const) {
      expect(featureFlags[key].default).toBe(false);
      expect(featureFlags[key].epic).toBe("E3a");
      expect(featureEpicPattern.test(featureFlags[key].epic)).toBe(true);
    }
  });

  test("docs_links defaults off, epic E10a, remove by 2027-06-01", () => {
    expect(featureFlags.docs_links).toEqual({
      default: false,
      description: "The Help link and the What is new card in the panel.",
      epic: "E10a",
      removeBy: "2027-06-01",
    });
    expect(featureEpicPattern.test(featureFlags.docs_links.epic)).toBe(true);
    expect(isFeatureKey("docs_links")).toBe(true);
  });

  test("answered_check defaults off and has the epic E3a", () => {
    expect(featureFlags.answered_check.default).toBe(false);
    expect(featureFlags.answered_check.epic).toBe("E3a");
    expect(featureEpicPattern.test(featureFlags.answered_check.epic)).toBe(true);
  });

  test("featureKeys lists the registry keys in registry order", () => {
    expect<string[]>(featureKeys).toEqual(Object.keys(featureFlags));
    expect(featureKeys.slice(0, 4)).toEqual(["stats_page", "approvals_page", "delegation_pages", "sent_sync"]);
  });

  test("isFeatureKey accepts registry keys only", () => {
    expect(isFeatureKey("stats_page")).toBe(true);
    for (const bad of ["STATS_PAGE", "", "stats_page ", "toString", "__proto__", "constructor"]) {
      expect(isFeatureKey(bad)).toBe(false);
    }
  });
});

describe("expiredFlags", () => {
  const flag = (removeBy: string): FeatureFlag => ({ default: false, description: "x", epic: "E1", removeBy });
  const fixture = { a: flag("2027-03-01"), b: flag("2027-04-01") };

  test("a flag is past its date the day after, not on the day", () => {
    expect(expiredFlags(fixture, "2027-02-28")).toEqual([]);
    expect(expiredFlags(fixture, "2027-03-01")).toEqual([]);
    expect(expiredFlags(fixture, "2027-03-02")).toEqual(["a"]);
    expect(expiredFlags(fixture, "2027-04-02")).toEqual(["a", "b"]);
  });

  test("no registry flag is past its remove-by date", () => {
    const today = new Date().toISOString().slice(0, 10);
    const lines = expiredFlags(featureFlags, today).map(
      (key) =>
        `flag ${key} is past its remove-by date ${featureFlags[key as keyof typeof featureFlags].removeBy}: open a cleanup ticket`
    );
    expect(lines).toEqual([]);
  });
});

describe("resolveFeature", () => {
  test.each([
    { defaultOn: true, killed: true, row: true, enabled: false, source: "env" },
    { defaultOn: false, killed: true, row: undefined, enabled: false, source: "env" },
    { defaultOn: true, killed: false, row: false, enabled: false, source: "row" },
    { defaultOn: false, killed: false, row: true, enabled: true, source: "row" },
    { defaultOn: false, killed: false, row: undefined, enabled: false, source: "default" },
    { defaultOn: true, killed: false, row: undefined, enabled: true, source: "default" },
  ] as const)("default $defaultOn, killed $killed, row $row → $enabled from $source", (row) => {
    const { enabled, source } = row;
    expect(resolveFeature({ defaultOn: row.defaultOn, killed: row.killed, row: row.row })).toEqual({ enabled, source });
  });
});
