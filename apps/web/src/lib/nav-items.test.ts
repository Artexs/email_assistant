import { describe, expect, test } from "bun:test";

import {
  approvalsBadge,
  navItems,
  pageTitle,
  phoneOverflow,
  phoneTabs,
  PHONE_TAB_LIMIT,
} from "../components/shell/nav-items";

const keys = (items: { key: string }[]) => items.map((item) => item.key);

describe("navItems", () => {
  // The order and the 5-tab limit for each combination of `approvals_page`, `delegation_pages`, `stats_page` and `open_loops`.
  const base = ["activity", "mailboxes", "settings", "rules"];
  const flags = ["approvals_page", "delegation_pages", "stats_page", "open_loops"] as const;
  const expectedAll = (features: readonly string[]): string[] => [
    "activity",
    ...(features.includes("approvals_page") ? ["approvals"] : []),
    // The F102 flag or the flag of the open loops shows the item.
    ...(features.includes("delegation_pages") || features.includes("open_loops") ? ["delegations"] : []),
    "mailboxes",
    "settings",
    "rules",
    ...(features.includes("stats_page") ? ["stats"] : []),
  ];

  const combinations: string[][] = [];
  for (let mask = 0; mask < 1 << flags.length; mask += 1) {
    combinations.push(flags.filter((_, index) => (mask & (1 << index)) !== 0));
  }

  test("the base items hold with no flag", () => {
    expect(keys(navItems([]))).toEqual(base);
  });

  for (const features of combinations) {
    test(`features [${features.join(", ")}]: order, at most ${PHONE_TAB_LIMIT} phone tabs, the rest in the menu`, () => {
      const all = expectedAll(features);
      expect(keys(navItems(features))).toEqual(all);
      expect(keys(phoneTabs(features))).toEqual(all.slice(0, PHONE_TAB_LIMIT));
      expect(phoneTabs(features).length).toBeLessThanOrEqual(PHONE_TAB_LIMIT);
      expect(keys(phoneOverflow(features))).toEqual(all.slice(PHONE_TAB_LIMIT));
      // Every item is in the tab bar or in the menu, never in both and never lost.
      expect([...keys(phoneTabs(features)), ...keys(phoneOverflow(features))]).toEqual(all);
    });
  }

  test("with the three flags on the phone shows Activity, Approvals, Delegations, Mailboxes, Settings", () => {
    expect(keys(phoneTabs([...flags]))).toEqual(["activity", "approvals", "delegations", "mailboxes", "settings"]);
    expect(keys(phoneOverflow([...flags]))).toEqual(["rules", "stats"]);
  });

  // The label of the Delegations item with the flag open_loops on and off.
  test("the Delegations item is Open loops while the flag open_loops is on, and Delegations otherwise", () => {
    const label = (features: string[]) => navItems(features).find((item) => item.key === "delegations")?.label;
    expect(label(["delegation_pages"])).toBe("nav_delegations");
    expect(label(["delegation_pages", "open_loops"])).toBe("nav_open_loops");
    expect(label(["open_loops"])).toBe("nav_open_loops");
    expect(label([])).toBeUndefined();
    // The address stays the F102 page, and no other item changes its label.
    expect(navItems(["delegation_pages", "open_loops"]).find((item) => item.key === "delegations")?.href).toBe(
      "/delegations"
    );
    expect(navItems(["open_loops"]).map((item) => item.label)).not.toContain("nav_delegations");
    expect(navItems(["delegation_pages"]).map((item) => item.label)).not.toContain("nav_open_loops");
  });

  test("another feature adds nothing", () => {
    expect(navItems(["security_log"])).toHaveLength(4);
  });

  test("each item links to its own page", () => {
    for (const item of navItems(["stats_page", "approvals_page", "delegation_pages", "open_loops"]))
      expect(item.href).toBe(`/${item.key}`);
  });
});

describe("pageTitle", () => {
  test("only the Delegations page changes its title, and only with the flag open_loops", () => {
    expect(pageTitle("delegations", "title_delegations", [])).toBe("title_delegations");
    expect(pageTitle("delegations", "title_delegations", ["delegation_pages"])).toBe("title_delegations");
    expect(pageTitle("delegations", "title_delegations", ["open_loops"])).toBe("title_open_loops");
    expect(pageTitle("approvals", "title_approvals", ["open_loops"])).toBe("title_approvals");
  });
});

describe("approvalsBadge", () => {
  // The badge text for 0, 1 and 100, and the edges of "99+".
  test("hidden at 0, the number up to 99, then 99+", () => {
    expect(approvalsBadge(0)).toBeNull();
    expect(approvalsBadge(1)).toBe("1");
    expect(approvalsBadge(99)).toBe("99");
    expect(approvalsBadge(100)).toBe("99+");
    expect(approvalsBadge(1000)).toBe("99+");
  });
});
