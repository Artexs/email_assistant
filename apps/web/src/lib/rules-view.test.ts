import { describe, expect, test } from "bun:test";
import type { RuleView } from "@ea/core/web";

import { groupRules, rulesPath, scopeLabel } from "./rules-view";

const MAILBOX = "11111111-1111-4111-8111-111111111111";
const GONE = "22222222-2222-4222-8222-222222222222";

function rule(id: string, kind: RuleView["kind"], mailboxId: string | null = null): RuleView {
  return {
    id: `00000000-0000-4000-8000-00000000000${id}`,
    kind,
    pattern: `p${id}.test`,
    mailboxId,
    createdAt: "2026-11-11T10:00:00.000Z",
  };
}

describe("groupRules", () => {
  test("splits five mixed rules into three lists in API order", () => {
    const rules = [
      rule("1", "blocklist"),
      rule("2", "vip"),
      rule("3", "whitelist"),
      rule("4", "vip"),
      rule("5", "blocklist"),
    ];
    const groups = groupRules(rules);
    expect(groups.vip.map((r) => r.pattern)).toEqual(["p2.test", "p4.test"]);
    expect(groups.whitelist.map((r) => r.pattern)).toEqual(["p3.test"]);
    expect(groups.blocklist.map((r) => r.pattern)).toEqual(["p1.test", "p5.test"]);
  });

  test("an empty list gives three empty lists", () => {
    expect(groupRules([])).toEqual({ vip: [], whitelist: [], blocklist: [] });
  });
});

describe("scopeLabel", () => {
  const mailboxes = [{ id: MAILBOX, address: "boss@firma.test" }];

  test("no mailbox means all mailboxes", () => {
    expect(scopeLabel(rule("1", "vip"), mailboxes)).toEqual({ key: "rules_all_mailboxes" });
  });

  test("a known mailbox gives its address", () => {
    expect(scopeLabel(rule("1", "vip", MAILBOX), mailboxes)).toEqual({ address: "boss@firma.test" });
  });

  test("an unknown mailbox gives the removed label", () => {
    expect(scopeLabel(rule("1", "vip", GONE), mailboxes)).toEqual({ key: "rules_scope_removed" });
  });
});

describe("rulesPath", () => {
  test("no filter has no query", () => {
    expect(rulesPath(null)).toBe("/api/rules");
  });

  test("the id is encoded", () => {
    expect(rulesPath("a b")).toBe("/api/rules?mailboxId=a%20b");
  });
});
