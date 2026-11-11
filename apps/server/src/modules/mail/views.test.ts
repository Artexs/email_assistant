import { mailboxScopeBadges, type ScopeEnv } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { claimFilterFor, sendFilterFor, type ActionsScope, type SendScope } from "../actions";

const TEST_ADDRESS = "Test@Example.test";
const addresses = [TEST_ADDRESS, "test@example.test", "other@example.test"];

describe("mailboxScopeBadges follows the committer filters", () => {
  const actionsScopes: ActionsScope[] = [
    { kind: "off" },
    { kind: "synthetic" },
    { kind: "all", mailboxAddress: TEST_ADDRESS },
  ];
  const sendScopes: SendScope[] = [
    { kind: "off" },
    { kind: "self", addresses: ["me@example.test"] },
    { kind: "all", mailboxAddress: TEST_ADDRESS },
  ];

  test("actions badge matches claimFilterFor", () => {
    for (const scope of actionsScopes) {
      for (const address of addresses) {
        const env: ScopeEnv = { triage: "off", actions: scope.kind, send: "off", testMailboxAddress: TEST_ADDRESS };
        const badge = mailboxScopeBadges(env, address).actions;
        const filter = claimFilterFor(scope, address);
        expect(badge.state === "on").toBe(filter.kind === "all");
        expect(badge.state === "synthetic").toBe(filter.kind === "synthetic");
      }
    }
  });

  test("send badge matches sendFilterFor", () => {
    for (const scope of sendScopes) {
      for (const address of addresses) {
        const env: ScopeEnv = { triage: "off", actions: "off", send: scope.kind, testMailboxAddress: TEST_ADDRESS };
        const badge = mailboxScopeBadges(env, address).send;
        const filter = sendFilterFor(scope, address);
        expect(badge.state === "on").toBe(filter.kind === "all");
        expect(badge.state === "self").toBe(filter.kind === "self");
      }
    }
  });
});
