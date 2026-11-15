import { describe, expect, test } from "bun:test";

import { approvalsBadge, navItems, phoneOverflow, phoneTabs, PHONE_TAB_LIMIT } from "../components/shell/nav-items";

const keys = (items: { key: string }[]) => items.map((item) => item.key);

describe("navItems", () => {
  // T1: the order and the 5-tab limit for each combination of `approvals_page` and `stats_page`.
  const cases = [
    { features: [] as string[], all: ["activity", "mailboxes", "settings", "rules"], overflow: [] as string[] },
    {
      features: ["stats_page"],
      all: ["activity", "mailboxes", "settings", "rules", "stats"],
      overflow: [],
    },
    {
      features: ["approvals_page"],
      all: ["activity", "approvals", "mailboxes", "settings", "rules"],
      overflow: [],
    },
    {
      features: ["stats_page", "approvals_page"],
      all: ["activity", "approvals", "mailboxes", "settings", "rules", "stats"],
      overflow: ["stats"],
    },
  ];

  for (const { features, all, overflow } of cases) {
    test(`features [${features.join(", ")}]: order, at most ${PHONE_TAB_LIMIT} phone tabs, the rest in the menu`, () => {
      expect(keys(navItems(features))).toEqual(all);
      expect(keys(phoneTabs(features))).toEqual(all.slice(0, PHONE_TAB_LIMIT));
      expect(phoneTabs(features).length).toBeLessThanOrEqual(PHONE_TAB_LIMIT);
      expect(keys(phoneOverflow(features))).toEqual(overflow);
      // Every item is in the tab bar or in the menu, never in both and never lost.
      expect([...keys(phoneTabs(features)), ...keys(phoneOverflow(features))]).toEqual(all);
    });
  }

  test("another feature adds nothing", () => {
    expect(navItems(["security_log"])).toHaveLength(4);
  });

  test("each item links to its own page", () => {
    for (const item of navItems(["stats_page", "approvals_page"])) expect(item.href).toBe(`/${item.key}`);
  });
});

describe("approvalsBadge", () => {
  // T2: the badge text for 0, 1 and 100, and the edges of "99+".
  test("hidden at 0, the number up to 99, then 99+", () => {
    expect(approvalsBadge(0)).toBeNull();
    expect(approvalsBadge(1)).toBe("1");
    expect(approvalsBadge(99)).toBe("99");
    expect(approvalsBadge(100)).toBe("99+");
    expect(approvalsBadge(1000)).toBe("99+");
  });
});
