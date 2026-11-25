import { loopCloseReasons, loopFilters, loopItemSchema, loopKinds, type LoopItem } from "@ea/core/web";
import { afterEach, describe, expect, test } from "bun:test";

import { LOOP_ROW_BY_KIND } from "../components/loops/loop-kinds";
import { setLocaleForTest, t } from "../i18n";
import { en } from "../i18n/en";
import { ApiError } from "./api";
import {
  followUpBlocked,
  LOOP_CLOSED_TEXTS,
  LOOP_FILTER_EMPTY,
  LOOP_FILTER_LABELS,
  LOOP_LIST_LABELS,
  LOOP_TAB_LABELS,
  LOOP_TABS,
  loopActions,
  loopFilterHref,
  loopFilterOf,
  loopName,
  loopOutcome,
  mergeLoopPages,
  reasonText,
  tabHref,
  tabOf,
  workingDaysWaited,
  type LoopAction,
} from "./loops-view";

afterEach(() => setLocaleForTest("en"));

const loop = (patch: Partial<LoopItem> = {}): LoopItem => ({
  kind: "waiting",
  id: "0190f5a0-0000-7000-8000-0000000000a1",
  status: "open",
  closeReason: null,
  counterpart: "client@example.com",
  delegate: null,
  text: "Send the offer",
  subject: "Offer",
  dueAt: "2026-11-20T10:00:00.000Z",
  dueSource: "default",
  usualReplyDays: null,
  sentAt: "2026-11-16T09:00:00.000Z",
  laterLeft: 3,
  followUpsSent: 0,
  followUpWaiting: false,
  sendId: null,
  matchedBySubject: false,
  autoReplyOnly: false,
  reason: "asked_no_answer",
  ...patch,
});

const apiError = (status: number, code: string) => new ApiError(status, code);
const owner = { owner: true, canWrite: true };
const member = { owner: false, canWrite: true };

describe("loopActions", () => {
  // The action list per kind, state and role equals the rules of the stage: a table over every kind, every `status` and
  // every `close_reason`.
  interface Row {
    owner: LoopAction[];
    member: LoopAction[];
  }
  const openTable: Record<(typeof loopKinds)[number], Row> = {
    waiting: { owner: ["follow_up", "later", "done", "drop"], member: ["later", "done"] },
    promised: { owner: ["done", "drop"], member: ["done"] },
    delegated: { owner: ["follow_up", "later", "done", "drop", "untrack"], member: ["later", "done"] },
  };

  for (const kind of loopKinds) {
    test(`${kind} open: owner, member and a suspended organization`, () => {
      const open = loop({ kind });
      expect(loopActions(open, owner)).toEqual(openTable[kind].owner);
      expect(loopActions(open, member)).toEqual(openTable[kind].member);
      expect(loopActions(open, { owner: true, canWrite: false })).toEqual([]);
      expect(loopActions(open, { owner: false, canWrite: false })).toEqual([]);
    });
  }

  test("a follow-up that waits hides Draft follow-up; the others stay", () => {
    expect(loopActions(loop({ followUpWaiting: true }), owner)).toEqual(["later", "done", "drop"]);
    expect(loopActions(loop({ kind: "delegated", followUpWaiting: true }), owner)).toEqual([
      "later",
      "done",
      "drop",
      "untrack",
    ]);
  });

  test("Later hides at 0 left and shows at 1", () => {
    expect(loopActions(loop({ laterLeft: 0 }), member)).toEqual(["done"]);
    expect(loopActions(loop({ laterLeft: 1 }), member)).toEqual(["later", "done"]);
    expect(loopActions(loop({ laterLeft: 0 }), owner)).toEqual(["follow_up", "done", "drop"]);
  });

  test("two follow-ups sent keep the button (the row shows the limit): the server decides", () => {
    expect(loopActions(loop({ followUpsSent: 2 }), owner)).toContain("follow_up");
    expect(followUpBlocked(loop({ followUpsSent: 2 }))).toBe(true);
    expect(followUpBlocked(loop({ followUpsSent: 1 }))).toBe(false);
  });

  for (const kind of loopKinds) {
    for (const closeReason of loopCloseReasons) {
      test(`${kind} closed (${closeReason}): Reopen only for an owner, only with a text, never after Sent tracking went off`, () => {
        const closed = loop({ kind, status: "closed", closeReason });
        const reopens = closeReason !== "sent_off";
        expect(loopActions(closed, owner)).toEqual(reopens ? ["reopen"] : []);
        expect(loopActions(closed, member)).toEqual([]);
        expect(loopActions(closed, { owner: true, canWrite: false })).toEqual([]);
        expect(loopActions({ ...closed, text: null }, owner)).toEqual([]);
      });
    }
  }
});

describe("the kind map", () => {
  // A component for every `LoopItem.kind`.
  test("has a component for every kind of the schema", () => {
    const kinds = [...loopItemSchema.shape.kind.options];
    expect([...kinds].sort()).toEqual([...loopKinds].sort());
    expect(Object.keys(LOOP_ROW_BY_KIND).sort()).toEqual([...kinds].sort());
    for (const kind of kinds) expect(typeof LOOP_ROW_BY_KIND[kind]).toBe("function");
  });
});

describe("tabs, filters and addresses", () => {
  test("the query parameter names the tab; none or an unknown one is Delegated", () => {
    expect(tabOf("")).toBe("delegated");
    expect(tabOf("?tab=waiting")).toBe("waiting");
    expect(tabOf("?tab=promised&filter=due")).toBe("promised");
    expect(tabOf("?tab=nope")).toBe("delegated");
    expect(tabOf("?filter=closed")).toBe("delegated");
    for (const tab of LOOP_TABS) expect(tabOf(new URL(tabHref(tab), "http://x").search)).toBe(tab);
  });

  test("the default tab keeps the plain address of the F102 page", () => {
    expect(tabHref("delegated")).toBe("/delegations");
    expect(tabHref("waiting")).toBe("/delegations?tab=waiting");
  });

  test("the state filter is a query parameter; none or an unknown one is Open", () => {
    expect(loopFilterOf("")).toBe("open");
    expect(loopFilterOf("?filter=due")).toBe("due");
    expect(loopFilterOf("?filter=overdue")).toBe("open");
    for (const filter of loopFilters) {
      const search = new URL(loopFilterHref("promised", filter), "http://x").search;
      expect(loopFilterOf(search)).toBe(filter);
      expect(tabOf(search)).toBe("promised");
    }
  });

  test("every tab, filter, kind and close reason has a text in both languages", () => {
    for (const tab of LOOP_TABS) expect(t(LOOP_TAB_LABELS[tab]).length).toBeGreaterThan(0);
    for (const filter of loopFilters) {
      expect(t(LOOP_FILTER_LABELS[filter]).length).toBeGreaterThan(0);
      expect(t(LOOP_FILTER_EMPTY[filter]).length).toBeGreaterThan(0);
    }
    for (const kind of loopKinds) expect(t(LOOP_LIST_LABELS[kind]).length).toBeGreaterThan(0);
    for (const reason of loopCloseReasons) expect(t(LOOP_CLOSED_TEXTS[reason]).length).toBeGreaterThan(0);
    setLocaleForTest("pl");
    expect(t(LOOP_TAB_LABELS.promised)).toBe("Obiecane");
    expect(t(LOOP_FILTER_LABELS.due)).toBe("Na dziś");
  });
});

describe("answers of the server", () => {
  test("follow-up: each 409 code gives its own text", () => {
    const codes: [string, string][] = [
      ["waiting", "lp_c_waiting"],
      ["closed", "lp_c_closed"],
      ["limit_reached", "lp_c_follow_up_limit"],
      ["too_soon", "lp_c_too_soon"],
      ["suspicious", "lp_c_suspicious"],
      ["drafts_off", "lp_c_drafts_off"],
      ["not_allowed", "lp_c_promised_follow_up"],
    ];
    for (const [code, key] of codes)
      expect(loopOutcome("follow_up", apiError(409, code))).toEqual({ kind: "notice", key } as never);
  });

  test("later, done, drop, untrack and reopen: their 409 codes", () => {
    expect(loopOutcome("later", apiError(409, "closed"))).toEqual({ kind: "notice", key: "lp_c_closed" });
    expect(loopOutcome("later", apiError(409, "limit_reached"))).toEqual({ kind: "notice", key: "lp_c_later_limit" });
    expect(loopOutcome("later", apiError(409, "not_allowed"))).toEqual({ kind: "notice", key: "lp_c_promised_later" });
    for (const action of ["done", "drop", "untrack"] as const) {
      expect(loopOutcome(action, apiError(409, "already"))).toEqual({ kind: "notice", key: "lp_c_already_closed" });
    }
    expect(loopOutcome("untrack", apiError(409, "not_allowed"))).toEqual({
      kind: "notice",
      key: "lp_c_untrack_not_allowed",
    });
    expect(loopOutcome("reopen", apiError(409, "already"))).toEqual({ kind: "notice", key: "lp_c_already_open" });
    expect(loopOutcome("reopen", apiError(409, "not_allowed"))).toEqual({
      kind: "notice",
      key: "lp_c_reopen_not_allowed",
    });
  });

  test("404 says the loop is gone; 403, an unknown code and a network error give the general texts", () => {
    for (const action of ["follow_up", "later", "done", "drop", "untrack", "reopen"] as const) {
      expect(loopOutcome(action, apiError(404, "not_found"))).toEqual({ kind: "gone" });
      expect(loopOutcome(action, apiError(409, "unheard_of"))).toEqual({ kind: "error", key: "error_generic" });
      expect(loopOutcome(action, apiError(403, "owner_only"))).toEqual({ kind: "error", key: "owner_only" });
      expect(loopOutcome(action, apiError(403, "org_suspended"))).toEqual({ kind: "error", key: "err_org_suspended" });
      expect(loopOutcome(action, new Error("network"))).toEqual({ kind: "error", key: "error_generic" });
    }
    // A code of another action is not this action's code.
    expect(loopOutcome("done", apiError(409, "waiting"))).toEqual({ kind: "error", key: "error_generic" });
  });
});

describe("workingDaysWaited", () => {
  const zone = "Europe/Warsaw";
  test("counts the weekdays after the day of the Sent mail up to today", () => {
    // 2026-11-16 is a Monday.
    expect(workingDaysWaited("2026-11-16T09:00:00.000Z", new Date("2026-11-16T15:00:00.000Z"), zone)).toBe(0);
    expect(workingDaysWaited("2026-11-16T09:00:00.000Z", new Date("2026-11-17T08:00:00.000Z"), zone)).toBe(1);
    expect(workingDaysWaited("2026-11-16T09:00:00.000Z", new Date("2026-11-19T08:00:00.000Z"), zone)).toBe(3);
  });

  test("a weekend adds nothing", () => {
    // Friday to Monday is one working day; Saturday and Sunday are none.
    expect(workingDaysWaited("2026-11-20T09:00:00.000Z", new Date("2026-11-23T08:00:00.000Z"), zone)).toBe(1);
    expect(workingDaysWaited("2026-11-20T09:00:00.000Z", new Date("2026-11-22T08:00:00.000Z"), zone)).toBe(0);
    expect(workingDaysWaited("2026-11-14T09:00:00.000Z", new Date("2026-11-16T08:00:00.000Z"), zone)).toBe(1);
  });

  test("the day is the day of the organization", () => {
    // 23:30 UTC on Monday is Tuesday 00:30 in Warsaw: Tuesday morning is the same day, not one working day later.
    expect(workingDaysWaited("2026-11-16T23:30:00.000Z", new Date("2026-11-17T08:00:00.000Z"), zone)).toBe(0);
    expect(workingDaysWaited("2026-11-16T23:30:00.000Z", new Date("2026-11-17T08:00:00.000Z"), "UTC")).toBe(1);
  });

  test("a date in the future is 0, and a very old one ends", () => {
    expect(workingDaysWaited("2026-11-20T09:00:00.000Z", new Date("2026-11-16T08:00:00.000Z"), zone)).toBe(0);
    expect(
      workingDaysWaited("2000-01-01T00:00:00.000Z", new Date("2026-11-16T08:00:00.000Z"), zone)
    ).toBeLessThanOrEqual(286);
  });
});

describe("reasonText", () => {
  const now = new Date("2026-11-20T08:00:00.000Z");
  const zone = "Europe/Warsaw";

  test("an open waiting loop says how long there is no answer", () => {
    expect(reasonText(loop({ sentAt: "2026-11-16T09:00:00.000Z" }), now, zone)).toBe(
      "You asked a question; no answer for 4 working days."
    );
    expect(reasonText(loop({ sentAt: "2026-11-19T09:00:00.000Z" }), now, zone)).toBe(
      "You asked a question; no answer for 1 working day."
    );
    expect(reasonText(loop({ sentAt: "2026-11-20T06:00:00.000Z" }), now, zone)).toBe(
      "You asked a question; no answer for less than a working day."
    );
  });

  test("Polish counts with the forms of the language", () => {
    setLocaleForTest("pl");
    const text = (sentAt: string) => reasonText(loop({ sentAt }), now, zone);
    expect(text("2026-11-16T09:00:00.000Z")).toBe("Pytanie bez odpowiedzi. Czas oczekiwania: 4 dni robocze.");
    expect(text("2026-11-19T09:00:00.000Z")).toBe("Pytanie bez odpowiedzi. Czas oczekiwania: 1 dzień roboczy.");
    expect(text("2026-11-09T09:00:00.000Z")).toBe("Pytanie bez odpowiedzi. Czas oczekiwania: 9 dni roboczych.");
  });

  test("a forward to a delegate and a promise have their own lines", () => {
    expect(
      reasonText(
        loop({ kind: "delegated", reason: "forwarded_to_delegate", sentAt: "2026-11-19T09:00:00.000Z" }),
        now,
        zone
      )
    ).toBe("You forwarded this to a delegate; no answer for 1 working day.");
    expect(reasonText(loop({ kind: "promised", reason: "promised" }), now, zone)).toBe(
      "You promised this in your sent mail."
    );
  });

  test("a closed loop says how it ended", () => {
    for (const reason of loopCloseReasons) {
      expect(reasonText(loop({ status: "closed", closeReason: reason }), now, zone)).toBe(
        en[LOOP_CLOSED_TEXTS[reason]]
      );
    }
  });
});

describe("names and pages", () => {
  test("the name is who it is about and what it is about; each part may be missing", () => {
    const delegate = { id: "0190f5a0-0000-7000-8000-0000000000d1", name: "Anna Nowak" };
    expect(loopName(loop({ delegate }))).toBe("Anna Nowak, Send the offer");
    expect(loopName(loop())).toBe("client@example.com, Send the offer");
    expect(loopName(loop({ text: null }))).toBe("client@example.com, Offer");
    expect(loopName(loop({ text: null, subject: null }))).toBe("client@example.com");
    expect(loopName(loop({ counterpart: null }))).toBe("Send the offer");
    expect(loopName(loop({ counterpart: null, text: null }))).toBe("Offer");
    expect(loopName(loop({ counterpart: null, text: null, subject: null }))).toBe("this loop");
  });

  test("the next page adds only the loops that are not loaded yet, in order", () => {
    const a = loop({ id: "a" });
    const b = loop({ id: "b" });
    const c = loop({ id: "c" });
    expect(mergeLoopPages([a, b], [b, c]).map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(mergeLoopPages([], [a]).map((x) => x.id)).toEqual(["a"]);
  });
});
