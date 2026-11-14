import { describe, expect, test } from "bun:test";

import { navItems } from "../components/shell/nav-items";

describe("navItems", () => {
  test("no feature gives the four tabs", () => {
    expect(navItems([])).toHaveLength(4);
  });

  test("stats_page adds Stats as the second item", () => {
    const items = navItems(["stats_page"]);
    expect(items).toHaveLength(5);
    expect(items.map((item) => item.key)).toEqual(["activity", "stats", "mailboxes", "settings", "rules"]);
  });

  test("another feature adds nothing", () => {
    expect(navItems(["security_log"])).toHaveLength(4);
  });
});
