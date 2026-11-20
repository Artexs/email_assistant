import { describe, expect, test } from "bun:test";

import { noticeKinds, type NoticeKind } from "./kinds";
import { noticeGroupNames, noticeGroupOf, noticeGroups, pushKinds } from "./push";
import {
  effectiveRoute,
  noticeRouteValues,
  noticeRoutesPatchSchema,
  noticeRoutesSchema,
  type EffectiveRoute,
  type NoticeRoutes,
  type NoticeRouteValue,
} from "./routes";

const both = { telegram: true, push: true };
const telegram = { telegram: true, push: false };
const push = { telegram: false, push: true };
const none = { telegram: false, push: false };

// The route of one kind: the group of the kind and the stored choice of that group (the composition of
// `apps/server/src/modules/channels/notice-fan-out.ts`).
function routeFor(input: {
  routes: NoticeRoutes;
  kind: NoticeKind;
  hasChat: boolean;
  hasDevice: boolean;
}): EffectiveRoute {
  const group = noticeGroupOf(input.kind);
  return effectiveRoute({
    stored: group === null ? undefined : input.routes[group],
    hasChat: input.hasChat,
    hasDevice: input.hasDevice,
    group,
  });
}

describe("effectiveRoute", () => {
  test("1. urgent, no choice, chat and device: Telegram and push", () => {
    expect(effectiveRoute({ stored: undefined, hasChat: true, hasDevice: true, group: "urgent" })).toEqual(both);
    expect(effectiveRoute({ stored: undefined, hasChat: true, hasDevice: true, group: "approvals" })).toEqual(both);
  });

  test("2. updates, no choice, chat and device: Telegram only", () => {
    expect(effectiveRoute({ stored: undefined, hasChat: true, hasDevice: true, group: "updates" })).toEqual(telegram);
  });

  test("3. urgent, no choice, chat and no device: Telegram only", () => {
    expect(effectiveRoute({ stored: undefined, hasChat: true, hasDevice: false, group: "urgent" })).toEqual(telegram);
  });

  test("4. urgent, choice push, chat and no device: Telegram only (fallback)", () => {
    expect(effectiveRoute({ stored: "push", hasChat: true, hasDevice: false, group: "urgent" })).toEqual(telegram);
  });

  test("5. approvals, choice telegram, no chat and a device: push only (fallback)", () => {
    expect(effectiveRoute({ stored: "telegram", hasChat: false, hasDevice: true, group: "approvals" })).toEqual(push);
  });

  test("6. updates, choice push, chat and device: push only", () => {
    expect(effectiveRoute({ stored: "push", hasChat: true, hasDevice: true, group: "updates" })).toEqual(push);
  });

  test("7. no chat and no device: nothing, for every group, every choice and no choice", () => {
    for (const group of [...noticeGroupNames, null]) {
      for (const stored of [undefined, ...noticeRouteValues]) {
        expect(effectiveRoute({ stored, hasChat: false, hasDevice: false, group })).toEqual(none);
      }
    }
  });

  test("a choice is kept in full when both channels exist; both falls to the one that exists", () => {
    const cases: [NoticeRouteValue, boolean, boolean, { telegram: boolean; push: boolean }][] = [
      ["telegram", true, true, telegram],
      ["push", true, true, push],
      ["both", true, true, both],
      ["both", true, false, telegram],
      ["both", false, true, push],
      ["telegram", true, false, telegram],
      ["push", false, true, push],
      ["telegram", false, false, none],
      ["push", false, false, none],
    ];
    for (const [stored, hasChat, hasDevice, want] of cases) {
      expect(effectiveRoute({ stored, hasChat, hasDevice, group: "updates" })).toEqual(want);
    }
  });

  test("no choice and no chat: a device gets the notice in every group", () => {
    for (const group of noticeGroupNames) {
      expect(effectiveRoute({ stored: undefined, hasChat: false, hasDevice: true, group })).toEqual(push);
    }
  });

  test("a kind with no group stays on Telegram whatever the choice and the device", () => {
    for (const stored of [undefined, ...noticeRouteValues]) {
      expect(effectiveRoute({ stored, hasChat: true, hasDevice: true, group: null })).toEqual(telegram);
      expect(effectiveRoute({ stored, hasChat: false, hasDevice: true, group: null })).toEqual(none);
    }
  });
});

describe("noticeGroups", () => {
  test("8. every kind is in at most one group; every group kind has a push; the Telegram-only kinds are in no group", () => {
    for (const group of noticeGroupNames) {
      for (const kind of noticeGroups[group]) {
        expect((pushKinds as readonly NoticeKind[]).includes(kind)).toBe(true);
        expect(noticeGroupOf(kind)).toBe(group);
      }
    }
    for (const kind of noticeKinds) {
      const groups = noticeGroupNames.filter((group) => (noticeGroups[group] as readonly NoticeKind[]).includes(kind));
      expect(groups.length).toBeLessThanOrEqual(1);
    }
    for (const kind of ["digest", "approval_edit", "reply_prompt", "reply_result", "loop_consent"] as const) {
      expect(noticeGroupOf(kind)).toBeNull();
    }
  });

  test("a notice of a kind with no group never goes to push, also for a member who chose push everywhere", () => {
    const routes = { urgent: "push", approvals: "push", updates: "push" } as const;
    for (const kind of ["digest", "approval_edit", "reply_prompt", "reply_result", "loop_consent"] as const) {
      expect(routeFor({ routes, kind, hasChat: true, hasDevice: true })).toEqual(telegram);
    }
    expect(routeFor({ routes, kind: "urgent", hasChat: true, hasDevice: true })).toEqual(push);
    expect(routeFor({ routes: {}, kind: "sync_ok", hasChat: true, hasDevice: true })).toEqual(telegram);
    expect(routeFor({ routes: {}, kind: "approval_set", hasChat: true, hasDevice: true })).toEqual(both);
  });
});

describe("noticeRoutesSchema", () => {
  test("it keeps the three groups and three values of the database CHECK, and nothing else", () => {
    expect(noticeRoutesSchema.parse({})).toEqual({});
    expect(noticeRoutesSchema.parse({ urgent: "push", approvals: "both", updates: "telegram" })).toEqual({
      urgent: "push",
      approvals: "both",
      updates: "telegram",
    });
    for (const bad of [
      { urgent: "fax" },
      { urgent: null },
      { urgent: ["push"] },
      { digest: "push" },
      { urgent: "push", extra: "telegram" },
      [],
      "push",
      null,
    ]) {
      expect(noticeRoutesSchema.safeParse(bad).success).toBe(false);
    }
  });

  test("the patch schema takes null (back to the default), refuses an empty body and a value outside the three", () => {
    expect(noticeRoutesPatchSchema.parse({ urgent: null })).toEqual({ urgent: null });
    expect(noticeRoutesPatchSchema.parse({ updates: "both", urgent: null })).toEqual({ updates: "both", urgent: null });
    for (const bad of [{}, { urgent: "fax" }, { digest: "push" }, { urgent: undefined }, []]) {
      expect(noticeRoutesPatchSchema.safeParse(bad).success).toBe(false);
    }
  });
});
