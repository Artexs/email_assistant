import { afterEach, describe, expect, test } from "bun:test";
import {
  approvalClosedStates,
  approvalDetailStates,
  approvalEditClosedCodes,
  heldBys,
  type ApprovalDetail,
} from "@ea/core/web";
import { DAY_MS, draftKinds, HOUR_MS, MINUTE_MS } from "@ea/core";

import { en } from "../i18n/en";
import { setLocaleForTest, t } from "../i18n";
import { pl } from "../i18n/pl";
import { ApiError } from "./api";
import {
  approveMessage,
  closedTextKey,
  decisions,
  durationText,
  failureOutcome,
  HELD_TEXTS,
  isUnknownSender,
  KIND_TITLES,
  recipientLabel,
  REJECT_REASONS,
  REASON_TEXTS,
  stateLabelKey,
  STATE_LABELS,
} from "./approvals-view";

afterEach(() => setLocaleForTest("en"));

const conflict = (raw: Record<string, unknown>, status = 409) =>
  new ApiError(status, String(raw.error), undefined, undefined, raw);
const SEND = "0190f5a0-0000-7000-8000-0000000000a1";

const detail = (patch: Partial<ApprovalDetail>): ApprovalDetail => ({
  id: SEND,
  mailboxAddress: "box@x.test",
  createdAt: "2026-11-20T10:00:00.000Z",
  delegationId: null,
  setId: null,
  version: 1,
  state: "held",
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

describe("the text maps", () => {
  // The state-to-label map covers every state of the detail, in both languages.
  test("every detail state, held cause, kind, closed state and reason has a text in en and pl", () => {
    const keys = [
      ...approvalDetailStates.map((state) => STATE_LABELS[state]),
      ...heldBys.map((cause) => HELD_TEXTS[cause]),
      ...draftKinds.map((kind) => KIND_TITLES[kind]),
      ...REJECT_REASONS.map((reason) => REASON_TEXTS[reason]),
      ...[...approvalClosedStates, ...approvalEditClosedCodes].map((state) => closedTextKey(state)),
      stateLabelKey("held", null),
    ];
    for (const key of keys) {
      expect(en[key], key).not.toBe("");
      expect(pl[key], key).not.toBe("");
    }
    expect(Object.keys(STATE_LABELS).sort()).toEqual([...approvalDetailStates].sort());
  });

  test("every state has its own label; a send in flight is not labelled Sent", () => {
    const labels = approvalDetailStates.map((state) => STATE_LABELS[state]);
    expect(new Set(labels).size).toBe(approvalDetailStates.length);
    expect(STATE_LABELS.sending).toBe("appr_state_sending");
    expect(STATE_LABELS.sent).toBe("appr_state_sent");
    for (const state of approvalDetailStates) expect(STATE_LABELS[state]).toBe(`appr_state_${state}`);
  });

  test("a held send with no cause is approved and sending soon, not a block", () => {
    expect(stateLabelKey("held", null)).toBe("appr_state_held_soon");
    expect(stateLabelKey("held", "scope")).toBe("appr_state_held");
    expect(stateLabelKey("waiting", null)).toBe("appr_state_waiting");
  });

  test("each closed-state name and each edit code has its own text; no name gets the general text", () => {
    const texts = [...approvalClosedStates, ...approvalEditClosedCodes].map((state) => closedTextKey(state));
    expect(new Set(texts).size).toBe(approvalClosedStates.length + approvalEditClosedCodes.length);
    expect(texts).not.toContain("appr_closed_other");
    expect(closedTextKey(undefined)).toBe("appr_closed_other");
  });

  test("fixed Polish and English values", () => {
    expect(pl.appr_dur_day).toBe("{n} dni");
    expect(pl.appr_preparing).toBe("Trwa przygotowywanie szkicu…");
    expect(pl.appr_none).toBe("Nic na Ciebie nie czeka");
    expect(en.appr_none).toBe("Nothing waits for you");
    expect(t("appr_done_sending", { to: "Anna" })).toBe("Sending to Anna.");
    expect(pl.appr_done_sent).toBe("Wysłano do: {to}.");
    expect(en.appr_state_held_soon).toBe("Approved, sending soon");
    expect(pl.appr_state_held_soon).toBe("Zatwierdzone, wkrótce zostanie wysłane");
    expect(pl.nav_approvals_badge).toBe("Oczekuje: {n}");
    setLocaleForTest("pl");
    expect(t("nav_approvals_badge", { n: "99+" })).toBe("Oczekuje: 99+");
    expect(t("appr_done_held", { reason: t("appr_held_paused") })).toBe(
      "Zatwierdzono. Skrzynka jest wstrzymana, więc wysyłanie czeka."
    );
  });
});

describe("approveMessage: the state and the cause come from the detail", () => {
  test("the answer `approved` for a send that is held with a cause names the cause, not a send", () => {
    const message = approveMessage(detail({ state: "held", heldBy: "paused" }), { status: "approved" });
    expect(message).toEqual({ key: "appr_done_held", reason: "appr_held_paused" });
  });

  test("a held send with no cause says sending; a send in flight says sending; a sent one says sent", () => {
    expect(approveMessage(detail({ state: "held", heldBy: null }), { status: "approved" })).toEqual({
      key: "appr_done_sending",
    });
    expect(approveMessage(detail({ state: "sending" }), { status: "approved" })).toEqual({ key: "appr_done_sending" });
    expect(approveMessage(detail({ state: "sent" }), { status: "approved" })).toEqual({ key: "appr_done_sent" });
    expect(approveMessage(detail({ state: "failed" }), { status: "approved" })).toEqual({ key: "appr_done_failed" });
  });

  test("the cause of the answer counts when the detail has none", () => {
    const message = approveMessage(detail({ state: "held", heldBy: null }), {
      status: "approved_held",
      heldBy: "scope",
    });
    expect(message).toEqual({ key: "appr_done_held", reason: "appr_held_scope" });
  });

  test("with no detail the page never promises a send", () => {
    expect(approveMessage(null, { status: "approved" })).toEqual({ key: "appr_done_unknown" });
    expect(approveMessage(detail({ state: "waiting" }), { status: "approved" })).toEqual({ key: "appr_done_unknown" });
  });

  test("a send that was closed meanwhile says so", () => {
    expect(approveMessage(detail({ state: "rejected" }), { status: "approved" })).toEqual({
      key: "appr_closed_rejected",
    });
    expect(approveMessage(detail({ state: "expired" }), { status: "approved" })).toEqual({
      key: "appr_closed_expired",
    });
  });
});

describe("failureOutcome", () => {
  test("409 changed with currentId loads the newest version", () => {
    expect(failureOutcome(conflict({ error: "changed", currentId: SEND }))).toEqual({
      kind: "changed",
      currentId: SEND,
    });
  });

  test("409 changed with no id, draft_not_ready and closed give a short text", () => {
    expect(failureOutcome(conflict({ error: "changed" }))).toEqual({ kind: "notice", key: "appr_changed" });
    expect(failureOutcome(conflict({ error: "draft_not_ready" }))).toEqual({
      kind: "notice",
      key: "appr_draft_not_ready",
    });
    for (const state of approvalClosedStates) {
      expect(failureOutcome(conflict({ error: "closed", state }))).toEqual({
        kind: "notice",
        key: closedTextKey(state),
      });
    }
    // A closed answer with no state name gets the general text; an edit code has its own text.
    expect(failureOutcome(conflict({ error: "closed" }))).toEqual({ kind: "notice", key: "appr_closed_other" });
    expect(failureOutcome(conflict({ error: "closed", state: "draft_gone" }))).toEqual({
      kind: "notice",
      key: "appr_closed_draft_gone",
    });
  });

  test("404 is gone; other answers and unreadable bodies go to the error banner", () => {
    expect(failureOutcome(conflict({ error: "not_found" }, 404))).toEqual({ kind: "gone" });
    expect(failureOutcome(conflict({ error: "internal" }, 500))).toEqual({ kind: "error", key: "error_generic" });
    expect(failureOutcome(conflict({ error: "owner_only" }, 403))).toEqual({ kind: "error", key: "owner_only" });
    expect(failureOutcome(conflict({ error: "something_else" }))).toEqual({ kind: "error", key: "error_generic" });
    expect(failureOutcome(new TypeError("network"))).toEqual({ kind: "error", key: "error_generic" });
    expect(failureOutcome(conflict({ error: "drafts_off" }))).toEqual({ kind: "error", key: "error_generic" });
  });
});

describe("decisions", () => {
  const owner = { owner: true, canWrite: true };

  test("an owner approves or rejects a waiting send and only rejects a held one", () => {
    expect(decisions({ state: "waiting" }, owner)).toEqual({ approve: true, reject: true });
    expect(decisions({ state: "held" }, owner)).toEqual({ approve: false, reject: true });
  });

  test("no button for a member, for a paused organization or for any other state", () => {
    expect(decisions({ state: "waiting" }, { owner: false, canWrite: true })).toEqual({
      approve: false,
      reject: false,
    });
    expect(decisions({ state: "waiting" }, { owner: true, canWrite: false })).toEqual({
      approve: false,
      reject: false,
    });
    for (const state of approvalDetailStates.filter((s) => s !== "waiting" && s !== "held")) {
      expect(decisions({ state }, owner)).toEqual({ approve: false, reject: false });
    }
  });
});

describe("small helpers", () => {
  test("recipientLabel spells out the name and the address", () => {
    expect(recipientLabel({ name: "Anna Nowak", address: "anna@example.com" })).toBe("Anna Nowak <anna@example.com>");
    expect(recipientLabel({ name: null, address: "anna@example.com" })).toBe("anna@example.com");
    expect(recipientLabel({ name: "", address: "anna@example.com" })).toBe("anna@example.com");
  });

  test("the stored English placeholder is the unknown sender", () => {
    expect(isUnknownSender("(unknown sender)")).toBe(true);
    expect(isUnknownSender("Boss")).toBe(false);
  });

  test("durationText rounds down for hours and days and never shows 0", () => {
    expect(durationText(-5)).toEqual({ key: "appr_dur_min", n: 1 });
    expect(durationText(30_000)).toEqual({ key: "appr_dur_min", n: 1 });
    expect(durationText(59 * MINUTE_MS)).toEqual({ key: "appr_dur_min", n: 59 });
    expect(durationText(HOUR_MS)).toEqual({ key: "appr_dur_hour", n: 1 });
    expect(durationText(47.9 * HOUR_MS)).toEqual({ key: "appr_dur_hour", n: 47 });
    expect(durationText(2 * DAY_MS)).toEqual({ key: "appr_dur_day", n: 2 });
    expect(durationText(7 * DAY_MS)).toEqual({ key: "appr_dur_day", n: 7 });
  });
});
