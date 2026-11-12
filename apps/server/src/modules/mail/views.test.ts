import { mailboxScopeBadges, type ScopeEnv } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { claimFilterFor, sendFilterFor, type ActionsScope, type SendScope } from "../actions";

describe("mailboxScopeBadges follows the committer filters", () => {
  const actionsScopes: ActionsScope[] = [{ kind: "off" }, { kind: "synthetic" }, { kind: "all" }];
  const sendScopes: SendScope[] = [{ kind: "off" }, { kind: "self", addresses: ["me@example.test"] }, { kind: "all" }];

  test("actions badge matches claimFilterFor", () => {
    for (const scope of actionsScopes) {
      const env: ScopeEnv = { triage: "off", actions: scope.kind, send: "off" };
      const badge = mailboxScopeBadges(env).actions;
      const filter = claimFilterFor(scope);
      expect(badge.state === "on").toBe(filter.kind === "all");
      expect(badge.state === "synthetic").toBe(filter.kind === "synthetic");
    }
  });

  test("send badge matches sendFilterFor", () => {
    for (const scope of sendScopes) {
      const env: ScopeEnv = { triage: "off", actions: "off", send: scope.kind };
      const badge = mailboxScopeBadges(env).send;
      const filter = sendFilterFor(scope);
      expect(badge.state === "on").toBe(filter.kind === "all");
      expect(badge.state === "self").toBe(filter.kind === "self");
    }
  });

  test("under all, two mailboxes with different addresses get the same badges", () => {
    const env: ScopeEnv = { triage: "all", actions: "all", send: "all" };
    expect(mailboxScopeBadges(env)).toEqual({
      triage: { state: "on", reason: "all_mailboxes" },
      actions: { state: "on", reason: "by_mode" },
      send: { state: "on", reason: "after_approval" },
    });
  });
});
