import { describe, expect, test } from "bun:test";
import type { ApprovalApproveAnswer, ApprovalDetail, ApprovalItem } from "@ea/core/web";

import { ApiError } from "./api";
import {
  ARM_MS,
  armed,
  closedSendKey,
  closedView,
  expiredNow,
  isClosedSendKey,
  nextFocus,
  outcomeOf,
  progress,
  queueIds,
  SENT_HOLD_MS,
  vanished,
  type DecisionResult,
  type Outcome,
} from "./approvals-queue";
import { errorText } from "./errors";

const uuid = (n: number) => `0190f5a0-0000-7000-8000-00000000000${n}`;
const ID = { a: uuid(1), b: uuid(2), c: uuid(3), d: uuid(4), e: uuid(5) };
const NEWER = uuid(9);

const item = (id: string, state: ApprovalItem["state"] = "waiting"): ApprovalItem => ({
  id,
  version: 1,
  state,
  draftReady: true,
  kind: "delegation",
  mailboxAddress: "box@x.test",
  createdAt: "2026-11-20T10:00:00.000Z",
  expiresAt: "2026-11-22T10:00:00.000Z",
  heldBy: null,
  delegationId: null,
  setId: null,
  view: {
    kind: "delegation",
    recipient: { name: "Anna", address: "anna@example.com" },
    sender: { label: "Boss", external: false },
    recipientInactive: false,
    subject: "Offer",
    dueDate: null,
    body: "Hello",
    quote: { text: "> text", cut: false },
    synthetic: false,
  },
});

const five = [ID.a, ID.b, ID.c, ID.d, ID.e].map((id) => item(id));
const none = new Set<string>();

const detail = (patch: Partial<ApprovalDetail>): ApprovalDetail => ({
  id: ID.a,
  mailboxAddress: "box@x.test",
  createdAt: "2026-11-20T10:00:00.000Z",
  delegationId: null,
  setId: null,
  version: 1,
  state: "sent",
  draftReady: true,
  kind: "delegation",
  expiresAt: null,
  heldBy: null,
  view: null,
  draftRemovable: true,
  currentId: null,
  quote: null,
  delegates: [],
  ...patch,
});

describe("the queue", () => {
  test("the lock times are 1.5 s after an outcome and 0.5 s before a new card arms", () => {
    expect([SENT_HOLD_MS, ARM_MS]).toEqual([1500, 500]);
  });

  test("nextFocus skips the leaving draft and the skipped ones; null when none is left", () => {
    const from = { leaving: ID.a, skipped: [] as string[], ownIds: none };
    expect(nextFocus(five, from)).toBe(ID.b);
    expect(nextFocus(five, { ...from, skipped: [ID.b] })).toBe(ID.c);
    expect(nextFocus(five, { ...from, skipped: [ID.b, ID.c, ID.d, ID.e] })).toBeNull();
  });

  test("nextFocus skips a draft this page decided, though a lagging reload still lists it", () => {
    expect(nextFocus(five, { leaving: ID.a, skipped: [], ownIds: new Set([ID.b]) })).toBe(ID.c);
  });

  test("queueIds leaves out a held draft", () => {
    const items = five.map((entry) => (entry.id === ID.c ? item(ID.c, "held") : entry));
    expect(queueIds(items, [], none)).toEqual([ID.a, ID.b, ID.d, ID.e]);
  });

  test.each([
    { name: "one approve done, four waiting", counts: { done: 1, waiting: 4 }, expected: { current: 2, total: 5 } },
    {
      name: "Later on the first, nothing decided",
      counts: { done: 0, waiting: 5 },
      expected: { current: 1, total: 5 },
    },
  ])("progress: $name", ({ counts, expected }) => {
    expect(progress(counts)).toEqual(expected);
  });

  test.each([
    {
      name: "gone, not ours",
      items: five.filter((e) => e.id !== ID.b),
      own: none,
      openedAs: "waiting",
      expected: true,
    },
    {
      name: "gone, ours",
      items: five.filter((e) => e.id !== ID.b),
      own: new Set([ID.b]),
      openedAs: "waiting",
      expected: false,
    },
    { name: "opened waiting, now held", items: [item(ID.b, "held")], own: none, openedAs: "waiting", expected: true },
    { name: "opened held, still held", items: [item(ID.b, "held")], own: none, openedAs: "held", expected: false },
  ] as const)("vanished: $name", ({ items, own, openedAs, expected }) => {
    expect(vanished(items, { id: ID.b, openedAs }, own)).toBe(expected);
  });

  test.each([
    { nowMs: 1499, expected: false },
    { nowMs: 1500, expected: true },
  ])("armed at $nowMs after a card shown at 1000", ({ nowMs, expected }) => {
    expect(armed(nowMs, 1000)).toBe(expected);
  });

  test.each([
    { now: "2026-11-24T09:59:59.999Z", expiresAt: "2026-11-24T10:00:00.000Z", expected: false },
    { now: "2026-11-24T10:00:00.000Z", expiresAt: "2026-11-24T10:00:00.000Z", expected: true },
    { now: "2026-11-24T10:00:00.000Z", expiresAt: null, expected: false },
  ])("expiredNow at $now with $expiresAt", ({ now, expiresAt, expected }) => {
    expect(expiredNow({ expiresAt }, new Date(now))).toBe(expected);
  });
});

const conflict = (raw: Record<string, unknown>) => new ApiError(409, String(raw.error), undefined, undefined, raw);
const answer: ApprovalApproveAnswer = { status: "approved" };
const approved = (patch: Partial<ApprovalDetail> | null, given = answer): DecisionResult => ({
  kind: "approved",
  answer: given,
  detail: patch === null ? null : detail(patch),
});
const failed = (error: unknown): DecisionResult => ({ kind: "failed", error });

describe("outcomeOf", () => {
  test.each<{ name: string; result: DecisionResult; expected: Outcome }>([
    {
      name: "approve, sent",
      result: approved({ state: "sent" }),
      expected: { text: { key: "appr_done_sent" }, then: "hold" },
    },
    {
      name: "approve, sending",
      result: approved({ state: "sending" }),
      expected: { text: { key: "appr_done_sending" }, then: "hold" },
    },
    {
      name: "approve, held with no cause",
      result: approved({ state: "held" }),
      expected: { text: { key: "appr_done_sending" }, then: "hold" },
    },
    {
      name: "approve, held with a cause",
      result: approved({ state: "held", heldBy: "paused" }, { status: "approved_held", heldBy: "paused" }),
      expected: { text: { key: "appr_done_held", reason: "appr_held_paused" }, then: "hold" },
    },
    {
      name: "approve, detail rejected",
      result: approved({ state: "rejected" }),
      expected: { text: { key: "appr_closed_rejected" }, then: "hold" },
    },
    {
      name: "approve, detail expired",
      result: approved({ state: "expired" }),
      expected: { text: { key: "appr_closed_expired" }, then: "hold" },
    },
    {
      name: "approve, detail failed",
      result: approved({ state: "failed" }),
      expected: { text: { key: "appr_done_failed" }, then: "next-button" },
    },
    {
      name: "approve, detail waiting",
      result: approved({ state: "waiting" }),
      expected: { text: { key: "appr_done_unknown" }, then: "next-button" },
    },
    {
      name: "approve, detail superseded",
      result: approved({ state: "superseded" }),
      expected: { text: { key: "appr_done_unknown" }, then: "next-button" },
    },
    {
      name: "approve, detail unreadable",
      result: approved(null),
      expected: { text: { key: "appr_done_unknown" }, then: "next-button" },
    },
    {
      name: "409 changed with a newer version",
      result: failed(conflict({ error: "changed", currentId: NEWER })),
      expected: { text: { key: "appr_changed" }, then: "stay", openId: NEWER },
    },
    {
      name: "409 changed with no newer id",
      result: failed(conflict({ error: "changed" })),
      expected: { text: { key: "appr_changed" }, then: "stay" },
    },
    {
      name: "409 closed, sent",
      result: failed(conflict({ error: "closed", state: "sent" })),
      expected: { text: { key: "appr_closed_sent" }, then: "hold" },
    },
    {
      name: "409 closed, sending after a fresh lock",
      result: failed(conflict({ error: "closed", state: "sending" })),
      expected: { text: { key: "appr_closed_sending" }, then: "hold" },
    },
    {
      name: "404",
      result: failed(new ApiError(404, "not_found")),
      expected: { text: { key: "appr_not_found" }, then: "hold" },
    },
    {
      name: "409 draft_not_ready",
      result: failed(conflict({ error: "draft_not_ready" })),
      expected: { text: { key: "appr_draft_not_ready" }, then: "stay" },
    },
    {
      name: "409 has_gaps",
      result: failed(conflict({ error: "has_gaps" })),
      expected: { text: { key: "appr_has_gaps" }, then: "stay" },
    },
    {
      name: "409 feature_off",
      result: failed(conflict({ error: "feature_off" })),
      expected: { text: { key: "appr_feature_off" }, then: "stay" },
    },
    {
      name: "reject, reason capture on",
      result: { kind: "rejected", mistakeCapture: true },
      expected: { text: { key: "appr_done_rejected" }, then: "reason" },
    },
    {
      name: "reject, reason capture off",
      result: { kind: "rejected", mistakeCapture: false },
      expected: { text: { key: "appr_done_rejected" }, then: "hold" },
    },
  ])("$name", ({ result, expected }) => {
    expect(outcomeOf(result)).toEqual(expected);
  });

  test("a network error stays on the card with the error text", () => {
    const error = new TypeError("Failed to fetch");
    expect(outcomeOf(failed(error))).toEqual({ text: { key: errorText(error) }, then: "stay" });
  });
});

describe("closedView", () => {
  test.each<{ name: string; detail: ApprovalDetail; expected: ReturnType<typeof closedView> }>([
    { name: "sent", detail: detail({ state: "sent" }), expected: { state: "appr_state_sent" } },
    {
      name: "rejected",
      detail: detail({ state: "rejected", endReason: "answered" }),
      expected: { state: "appr_state_rejected" },
    },
    {
      name: "expired, answered",
      detail: detail({ state: "expired", endReason: "answered" }),
      expected: { state: "appr_state_expired", reason: "rp_end_answered" },
    },
    {
      name: "failed",
      detail: detail({ state: "failed", endReason: "answered" }),
      expected: { state: "appr_state_failed" },
    },
    {
      name: "superseded",
      detail: detail({ state: "superseded", currentId: NEWER }),
      expected: { state: "appr_state_superseded", newest: NEWER },
    },
  ])("$name", ({ detail: given, expected }) => {
    expect(closedView(given)).toEqual(expected);
  });

  test.each([
    { state: "rejected", expected: "appr_closed_rejected" },
    { state: "sent", expected: "appr_closed_sent" },
    { state: "held", expected: "appr_closed_held" },
    { state: "waiting", expected: null },
    { state: "superseded", expected: null },
  ] as const)("closedSendKey of $state", ({ state, expected }) => {
    expect(closedSendKey(state)).toBe(expected);
  });

  test.each([
    { key: "appr_closed_expired", expected: true },
    { key: "appr_closed_draft_gone", expected: false },
    { key: "appr_closed_other", expected: false },
  ] as const)("isClosedSendKey of $key", ({ key, expected }) => {
    expect(isClosedSendKey(key)).toBe(expected);
  });
});
