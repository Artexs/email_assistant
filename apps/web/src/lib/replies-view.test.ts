import { describe, expect, test } from "bun:test";
import {
  approvalEndReasons,
  replyBlockReasons,
  replyConflictCodes,
  replyRecipientsRefusals,
  REPLY_INSTRUCTION_MAX,
} from "@ea/core/web";

import { en } from "../i18n/en";
import { pl } from "../i18n/pl";
import { ApiError } from "./api";
import {
  addressText,
  BLOCKED_TEXTS,
  copyChecked,
  END_REASON_TEXTS,
  endReasonKey,
  instructionState,
  redraftState,
  REFUSAL_TEXTS,
  replyFailure,
  resultTextKey,
} from "./replies-view";

const SEND = "0190f5a0-0000-7000-8000-0000000000a1";
const api = (status: number, raw: Record<string, unknown>) =>
  new ApiError(status, String(raw.error), undefined, undefined, raw);

describe("every code of the reply routes has a text in both languages", () => {
  test("a blocked reason, a refusal and an end reason each map to an existing key; the maps list every code", () => {
    expect(Object.keys(BLOCKED_TEXTS).sort()).toEqual([...replyBlockReasons].sort());
    expect(Object.keys(REFUSAL_TEXTS).sort()).toEqual([...replyRecipientsRefusals].sort());
    expect(Object.keys(END_REASON_TEXTS).sort()).toEqual([...approvalEndReasons].sort());
    for (const key of [
      ...Object.values(BLOCKED_TEXTS),
      ...Object.values(REFUSAL_TEXTS),
      ...Object.values(END_REASON_TEXTS),
    ]) {
      expect(en[key].length, key).toBeGreaterThan(10);
      expect(pl[key].length, key).toBeGreaterThan(10);
      expect(pl[key], key).not.toBe(en[key]);
    }
  });

  test("the 409 codes: blocked names the reason, changed the newest id, closed the state; a code with no text cannot exist", () => {
    expect(replyFailure(api(409, { error: "blocked", reason: "suspicious" }))).toEqual({
      kind: "message",
      key: "rp_blocked_suspicious",
    });
    expect(replyFailure(api(409, { error: "blocked" }))).toEqual({ kind: "message", key: "rp_result_generic" });
    expect(replyFailure(api(409, { error: "changed", currentId: SEND }))).toEqual({
      kind: "changed",
      currentId: SEND,
    });
    expect(replyFailure(api(409, { error: "changed" }))).toEqual({ kind: "changed", currentId: null });
    expect(replyFailure(api(409, { error: "closed", state: "sent" }))).toEqual({
      kind: "closed",
      key: "appr_closed_sent",
    });
    expect(replyFailure(api(409, { error: "closed" }))).toEqual({ kind: "closed", key: "appr_closed_other" });
    expect(replyFailure(api(409, { error: "redraft_limit" }))).toEqual({
      kind: "message",
      key: "rp_err_redraft_limit",
    });
    expect(replyFailure(api(409, { error: "drafts_off" }))).toEqual({ kind: "message", key: "rp_err_drafts_off" });
    // Every code of the schema was handled above (the switch of the function is exhaustive: a new code breaks the build).
    expect(replyConflictCodes).toEqual(["blocked", "changed", "closed", "redraft_limit", "drafts_off"]);
  });

  test("the 400 codes of the recipients route each have their own text; validation asks for one line", () => {
    for (const code of replyRecipientsRefusals) {
      expect(replyFailure(api(400, { error: code }))).toEqual({ kind: "message", key: REFUSAL_TEXTS[code] });
    }
    expect(replyFailure(api(400, { error: "validation" }))).toEqual({ kind: "message", key: "rp_err_instruction" });
  });

  test("404 is gone; an unknown 409 body, another status and a plain error are errors with the generic text", () => {
    expect(replyFailure(api(404, { error: "not_found" }))).toEqual({ kind: "gone" });
    expect(replyFailure(api(409, { error: "something_new" }))).toEqual({ kind: "error", key: "error_generic" });
    expect(replyFailure(api(500, { error: "internal" }))).toEqual({ kind: "error", key: "error_generic" });
    expect(replyFailure(new Error("network"))).toEqual({ kind: "error", key: "error_generic" });
  });
});

describe("the text of a request that ended with no new version", () => {
  test("a known code has its text, an eligibility reason its own, an unknown or missing code the generic line", () => {
    expect(resultTextKey("needs_facts")).toBe("rp_result_needs_facts");
    expect(resultTextKey("llm_cap")).toBe("rp_result_llm_cap");
    expect(resultTextKey("switch_off")).toBe("rp_result_off");
    expect(resultTextKey("not_assist")).toBe("rp_result_off");
    // The org flag has no switch in the mailbox settings: its text does not send the user there.
    expect(resultTextKey("feature_off")).toBe("rp_result_org_off");
    expect(resultTextKey("answered")).toBe("rp_blocked_answered");
    expect(resultTextKey("hasOwnProperty")).toBe("rp_result_generic");
    expect(resultTextKey("brand_new_code")).toBe("rp_result_generic");
    expect(resultTextKey(null)).toBe("rp_result_generic");
  });

  test("an expired send names its end reason; a timeout and another state name none", () => {
    expect(endReasonKey({ state: "expired", endReason: "newer_mail" })).toBe("rp_end_newer_mail");
    expect(endReasonKey({ state: "expired" })).toBeNull();
    expect(endReasonKey({ state: "failed", endReason: "answered" })).toBeNull();
  });
});

describe("the instruction line", () => {
  test("the count follows the service: cleaned, one line, 1 to 300 characters", () => {
    expect(instructionState("")).toMatchObject({ length: 0, ok: false, line: null });
    expect(instructionState("   \n ")).toMatchObject({ length: 0, ok: false, line: null });
    expect(instructionState("tak na wtorek")).toEqual({
      length: 13,
      max: REPLY_INSTRUCTION_MAX,
      ok: true,
      line: "tak na wtorek",
    });
    expect(instructionState("a‮b\nc")).toMatchObject({ ok: true, line: "ab c", length: 4 });
    expect(instructionState("x".repeat(300)).ok).toBe(true);
    expect(instructionState("x".repeat(301))).toMatchObject({ ok: false, line: null, length: 301 });
    // A letter outside the basic plane is one character, as the service counts it.
    expect(instructionState("😀".repeat(300)).ok).toBe(true);
  });

  test("the Redraft button is off with no line, with no redrafts left and while a request waits", () => {
    expect(redraftState({ redraftsLeft: 5, line: "krócej", waiting: false })).toEqual({ enabled: true, reason: null });
    expect(redraftState({ redraftsLeft: undefined, line: "krócej", waiting: false }).enabled).toBe(true);
    expect(redraftState({ redraftsLeft: 5, line: null, waiting: false }).enabled).toBe(false);
    expect(redraftState({ redraftsLeft: 5, line: "krócej", waiting: true })).toEqual({ enabled: false, reason: null });
    expect(redraftState({ redraftsLeft: 0, line: "krócej", waiting: false })).toEqual({
      enabled: false,
      reason: "rp_redraft_none",
    });
  });
});

describe("an address before a send", () => {
  test("an ASCII address is shown as it is, with or without a name", () => {
    expect(addressText("anna@client.test")).toEqual({ text: "anna@client.test", unusual: false });
    expect(addressText("Anna <anna@client.test>")).toEqual({ text: "Anna <anna@client.test>", unusual: false });
    expect(addressText("a@xn--clent-9ua.test")).toEqual({ text: "a@xn--clent-9ua.test", unusual: false });
  });

  test("a domain with a letter of another script shows as punycode and is marked; the local part keeps its text and is marked", () => {
    // `і` in the domain is Cyrillic (U+0456); the page shows the domain as the browser would send it.
    expect(addressText("anna@clіent.test")).toEqual({ text: "anna@xn--clent-o2e.test", unusual: true });
    expect(addressText("Anna <anna@clіent.test>")).toEqual({ text: "anna@xn--clent-o2e.test", unusual: true });
    expect(addressText("аnna@client.test")).toEqual({ text: "аnna@client.test", unusual: true });
    expect(addressText("anna@exämple.com")).toEqual({ text: "anna@xn--exmple-cua.com", unusual: true });
  });
});

describe("the note under a draft", () => {
  test("the edit-in-the-mail-client text shows for a reply and for any kind with the copy check on", () => {
    expect(copyChecked({ kind: "reply" })).toBe(true);
    expect(copyChecked({ kind: "delegation" })).toBe(false);
    expect(copyChecked({ kind: "delegation", copyCheck: true })).toBe(true);
  });
});
