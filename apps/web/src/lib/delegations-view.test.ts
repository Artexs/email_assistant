import { delegationFilters, delegationItemSchema, delegationStatuses, type DelegationItem } from "@ea/core/web";
import { afterEach, describe, expect, test } from "bun:test";

import { ROW_BY_KIND } from "../components/delegation/delegation-kinds";
import { en } from "../i18n/en";
import { setLocaleForTest, t } from "../i18n";
import { ApiError } from "./api";
import {
  cancelOutcome,
  dueText,
  delegationActions,
  doneOutcome,
  FILTER_EMPTY,
  FILTER_LABELS,
  filterHref,
  filterOf,
  mergePages,
  REMIND_BLOCK_TEXTS,
  REMIND_BLOCKS,
  remindBlock,
  remindOutcome,
  STATUS_LABELS,
} from "./delegations-view";

afterEach(() => setLocaleForTest("en"));

const item = (patch: Partial<DelegationItem> = {}): DelegationItem => ({
  kind: "delegation",
  id: "0190f5a0-0000-7000-8000-0000000000e1",
  status: "sent",
  delegate: { id: "0190f5a0-0000-7000-8000-0000000000d1", name: "Anna Nowak", email: "anna@example.com", active: true },
  task: "Send the numbers",
  subject: "Budget",
  dueAt: "2026-11-20T10:00:00.000Z",
  sentAt: "2026-11-15T10:00:00.000Z",
  answeredAt: null,
  remindersSent: 0,
  reminderWaiting: false,
  sendId: null,
  ...patch,
});

const apiError = (status: number, code: string) => new ApiError(status, code);

describe("delegationActions", () => {
  // T2: the action list per state and role equals the table of the stage (every `DelegationStatus`).
  const table: Record<(typeof delegationStatuses)[number], { owner: string[]; member: string[] }> = {
    drafted: { owner: ["cancel"], member: [] },
    sent: { owner: ["remind", "cancel"], member: [] },
    answered: { owner: ["done"], member: ["done"] },
    overdue: { owner: ["remind", "done", "cancel"], member: ["done"] },
    done: { owner: [], member: [] },
    cancelled: { owner: [], member: [] },
  };

  for (const status of delegationStatuses) {
    test(`${status}: owner, member and a suspended organization`, () => {
      expect(delegationActions(status, { owner: true, canWrite: true })).toEqual(table[status].owner as never);
      expect(delegationActions(status, { owner: false, canWrite: true })).toEqual(table[status].member as never);
      expect(delegationActions(status, { owner: true, canWrite: false })).toEqual([]);
      expect(delegationActions(status, { owner: false, canWrite: false })).toEqual([]);
    });
  }

  test("the table lists every status", () => {
    expect(Object.keys(table).sort()).toEqual([...delegationStatuses].sort());
  });
});

describe("the kind map", () => {
  // T3: a component for every `DelegationItem.kind`.
  test("has a component for every kind of the schema", () => {
    const kinds = [...delegationItemSchema.shape.kind.values];
    expect(kinds.length).toBeGreaterThan(0);
    expect(Object.keys(ROW_BY_KIND).sort()).toEqual([...kinds].sort());
    for (const kind of kinds) expect(typeof ROW_BY_KIND[kind]).toBe("function");
  });
});

describe("filters and labels", () => {
  test("every filter and status has a text in both languages", () => {
    for (const filter of delegationFilters) {
      expect(t(FILTER_LABELS[filter]).length).toBeGreaterThan(0);
      expect(t(FILTER_EMPTY[filter]).length).toBeGreaterThan(0);
    }
    for (const status of delegationStatuses) expect(t(STATUS_LABELS[status]).length).toBeGreaterThan(0);
    setLocaleForTest("pl");
    expect(t(STATUS_LABELS.overdue)).toBe("Po terminie");
    expect(t(FILTER_LABELS.answered)).toBe("Z odpowiedzią");
  });

  test("the query parameter names the tab; none or an unknown one is Open", () => {
    expect(filterOf("")).toBe("open");
    expect(filterOf("?filter=closed")).toBe("closed");
    expect(filterOf("?filter=overdue&x=1")).toBe("overdue");
    expect(filterOf("?filter=nope")).toBe("open");
    expect(filterOf("?filter=")).toBe("open");
    for (const filter of delegationFilters)
      expect(filterOf(new URL(filterHref(filter), "http://x").search)).toBe(filter);
  });
});

describe("remindBlock", () => {
  test("a sent delegation with room, no waiting reminder and an active delegate can be reminded", () => {
    expect(remindBlock(item())).toBeNull();
    expect(remindBlock(item({ status: "overdue", remindersSent: 1 }))).toBeNull();
  });

  test("each cause that the row shows names its code", () => {
    expect(remindBlock(item({ remindersSent: 2 }))).toBe("limit_reached");
    expect(remindBlock(item({ reminderWaiting: true }))).toBe("reminder_waiting");
    expect(remindBlock(item({ delegate: { ...item().delegate, active: false } }))).toBe("delegate_inactive");
    expect(remindBlock(item({ status: "answered" }))).toBe("not_open");
  });

  test("the order is the order of the server checks", () => {
    const off = { ...item().delegate, active: false };
    expect(remindBlock(item({ remindersSent: 2, reminderWaiting: true, delegate: off }))).toBe("limit_reached");
    expect(remindBlock(item({ reminderWaiting: true, delegate: off }))).toBe("reminder_waiting");
  });

  test("all five 409 codes have a text in both languages, and the limit text names the limit", () => {
    expect<string[]>([...REMIND_BLOCKS].sort()).toEqual(
      ["delegate_inactive", "drafts_off", "limit_reached", "not_open", "reminder_waiting"].sort()
    );
    for (const code of REMIND_BLOCKS) expect(t(REMIND_BLOCK_TEXTS[code], { max: 2 })).not.toContain("{");
    expect(t(REMIND_BLOCK_TEXTS.drafts_off)).toBe("Reminders need assist mode with drafts on.");
    expect(t(REMIND_BLOCK_TEXTS.limit_reached, { max: 2 })).toContain("2");
  });
});

describe("answers of the server", () => {
  test("remind: each 409 code gives its own text and the block that the row shows", () => {
    for (const code of REMIND_BLOCKS) {
      expect(remindOutcome(apiError(409, code))).toEqual({
        kind: "notice",
        key: REMIND_BLOCK_TEXTS[code],
        block: code,
      });
    }
    expect(remindOutcome(apiError(404, "not_found"))).toEqual({ kind: "gone" });
    expect(remindOutcome(apiError(409, "other"))).toEqual({ kind: "error", key: "error_generic" });
    expect(remindOutcome(apiError(403, "owner_only"))).toEqual({ kind: "error", key: "owner_only" });
    expect(remindOutcome(new Error("network"))).toEqual({ kind: "error", key: "error_generic" });
  });

  test("done: already and not_closable; cancel: sending and not_open", () => {
    expect(doneOutcome(apiError(409, "already"))).toEqual({ kind: "notice", key: "dgn_closed" });
    expect(doneOutcome(apiError(409, "not_closable"))).toEqual({ kind: "notice", key: "dgn_done_not_closable" });
    expect(doneOutcome(apiError(404, "not_found"))).toEqual({ kind: "gone" });
    expect(cancelOutcome(apiError(409, "sending"))).toEqual({ kind: "notice", key: "dgn_cancel_sending" });
    expect(cancelOutcome(apiError(409, "not_open"))).toEqual({ kind: "notice", key: "dgn_closed" });
    expect(cancelOutcome(apiError(404, "not_found"))).toEqual({ kind: "gone" });
    expect(cancelOutcome(apiError(500, "internal"))).toEqual({ kind: "error", key: "error_generic" });
    expect(en.dgn_cancel_sending).toBe("The mail is being sent now.");
  });
});

describe("pages and dates", () => {
  test("the next page adds only the delegations that are not loaded yet, in order", () => {
    const a = item({ id: "a" });
    const b = item({ id: "b" });
    const c = item({ id: "c" });
    expect(mergePages([a, b], [b, c]).map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(mergePages([], [a]).map((x) => x.id)).toEqual(["a"]);
  });

  test("the due date is a calendar day of the organization", () => {
    expect(dueText("2026-11-20T23:30:00.000Z", "Europe/Warsaw", "en-GB")).toBe("21 Nov 2026");
    expect(dueText("2026-11-20T23:30:00.000Z", "UTC", "en-GB")).toBe("20 Nov 2026");
  });
});
