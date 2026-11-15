import { afterEach, describe, expect, test } from "bun:test";
import { approvalClosedStates, approvalEditClosedCodes, type ApprovalDetail } from "@ea/core/web";

import { en } from "../i18n/en";
import { pl } from "../i18n/pl";
import { setLocaleForTest, t } from "../i18n";
import { ApiError } from "./api";
import {
  canEdit,
  delegateOptions,
  EDIT_BODY_MAX,
  EDIT_SUBJECT_MAX,
  editOutcome,
  editRequest,
  editStart,
  isDirty,
  saveState,
  type EditValues,
} from "./approvals-edit";

afterEach(() => setLocaleForTest("en"));

const ANNA = { id: "0190f5a0-0000-7000-8000-0000000000d1", name: "Anna Nowak", email: "anna@example.com" };
const PIOTR = { id: "0190f5a0-0000-7000-8000-0000000000d2", name: "Piotr Lis", email: "piotr@example.com" };
const NEWEST = "0190f5a0-0000-7000-8000-0000000000a2";

const detail = (patch: Partial<ApprovalDetail> = {}): ApprovalDetail => ({
  id: "0190f5a0-0000-7000-8000-0000000000a1",
  mailboxAddress: "box@example.com",
  createdAt: "2026-11-20T10:00:00.000Z",
  delegationId: null,
  setId: null,
  version: 1,
  state: "waiting",
  draftReady: true,
  kind: "delegation",
  expiresAt: "2026-11-22T10:00:00.000Z",
  heldBy: null,
  view: {
    kind: "delegation",
    recipient: { name: "Piotr Lis", address: "piotr@example.com" },
    sender: null,
    recipientInactive: false,
    subject: "Budget",
    dueDate: null,
    body: "Hello Piotr,\nplease send the report.",
    quote: null,
    synthetic: false,
  },
  draftRemovable: true,
  currentId: null,
  quote: "> quoted",
  delegates: [ANNA, PIOTR],
  ...patch,
});

const start: EditValues = { subject: "Budget", body: "Hello Piotr,\nplease send the report.", delegateId: PIOTR.id };

describe("the edit form state (T1)", () => {
  test("the form starts with the subject, the full body and the current delegate; no change, no Save", () => {
    expect(editStart(detail())).toEqual(start);
    const state = saveState(start, start);
    expect(state.canSave).toBe(false);
    expect(state.changed).toBe(false);
  });

  test("Save is off for an empty subject, for a body of 3001 characters and for no change; one change turns it on", () => {
    expect(saveState(start, { ...start, subject: "" }).canSave).toBe(false);
    expect(saveState(start, { ...start, subject: "   " }).canSave).toBe(false);
    expect(saveState(start, { ...start, body: "x".repeat(EDIT_BODY_MAX + 1) }).canSave).toBe(false);
    expect(saveState(start, { ...start, body: "" }).canSave).toBe(false);
    expect(saveState(start, { ...start, subject: "x".repeat(EDIT_SUBJECT_MAX + 1) }).canSave).toBe(false);
    expect(saveState(start, start).canSave).toBe(false);
    expect(saveState(start, { ...start, subject: "Budget 2027" }).canSave).toBe(true);
    expect(saveState(start, { ...start, body: "New text" }).canSave).toBe(true);
    expect(saveState(start, { ...start, delegateId: ANNA.id }).canSave).toBe(true);
  });

  test("the limits are the edges: 200 and 3000 characters are fine", () => {
    expect(saveState(start, { ...start, subject: "x".repeat(EDIT_SUBJECT_MAX) }).canSave).toBe(true);
    expect(saveState(start, { ...start, body: "x".repeat(EDIT_BODY_MAX) }).canSave).toBe(true);
  });

  test("the length counts the text that the server keeps: line ends and the outer space are cleaned", () => {
    const state = saveState(start, { ...start, body: `${"x".repeat(EDIT_BODY_MAX)}   \n\n` });
    expect(state.bodyLength).toBe(EDIT_BODY_MAX);
    expect(state.canSave).toBe(true);
    // Space at the line ends changes nothing for the server: no Save for it.
    expect(saveState(start, { ...start, body: `${start.body}  ` }).canSave).toBe(false);
  });

  test("closing asks about any typed change, also a space; an untouched form closes at once", () => {
    expect(isDirty(start, start)).toBe(false);
    expect(isDirty(start, { ...start, body: `${start.body} ` })).toBe(true);
    expect(isDirty(start, { ...start, delegateId: ANNA.id })).toBe(true);
  });

  test("the request holds the cleaned text, and the delegate only when it is another one", () => {
    expect(editRequest(start, { ...start, subject: " Budget  2027 ", body: "Hi  \r\nthere" })).toEqual({
      subject: "Budget 2027",
      body: "Hi\nthere",
    });
    expect(editRequest(start, { ...start, delegateId: ANNA.id })).toEqual({
      subject: "Budget",
      body: start.body,
      delegateId: ANNA.id,
    });
  });
});

describe("who edits what", () => {
  const owner = { owner: true, canWrite: true };
  test("an owner edits a waiting delegation or clarification; a reminder, a held send and a member get no Edit", () => {
    expect(canEdit({ state: "waiting", kind: "delegation" }, owner)).toBe(true);
    expect(canEdit({ state: "waiting", kind: "clarification" }, owner)).toBe(true);
    expect(canEdit({ state: "waiting", kind: "reminder" }, owner)).toBe(false);
    expect(canEdit({ state: "waiting", kind: null }, owner)).toBe(false);
    expect(canEdit({ state: "held", kind: "delegation" }, owner)).toBe(false);
    expect(canEdit({ state: "sent", kind: "delegation" }, owner)).toBe(false);
    expect(canEdit({ state: "waiting", kind: "delegation" }, { owner: false, canWrite: true })).toBe(false);
    expect(canEdit({ state: "waiting", kind: "delegation" }, { owner: true, canWrite: false })).toBe(false);
  });

  test("a draft with no text has no form; the picker lists the current delegate first and only for a delegation", () => {
    expect(editStart(detail({ view: null }))).toBeNull();
    expect(delegateOptions(detail()).map((delegate) => delegate.id)).toEqual([PIOTR.id, ANNA.id]);
    expect(delegateOptions(detail({ kind: "clarification" }))).toEqual([]);
    // The current delegate is not active: no start value, and the active ones are all offered.
    const inactive = detail({ delegates: [ANNA] });
    expect(editStart(inactive)?.delegateId).toBeNull();
    expect(delegateOptions(inactive)).toEqual([ANNA]);
    expect(editStart(detail({ kind: "clarification" }))?.delegateId).toBeNull();
  });
});

const failure = (
  status: number,
  code: string,
  raw: Record<string, unknown> = { error: code },
  details?: ApiError["details"]
) => new ApiError(status, code, undefined, details, raw);

describe("the answer map of an edit (T2)", () => {
  test("a saved edit says the version and asks for the approval", () => {
    expect(t("appr_edit_saved", { n: 2 })).toBe("Saved as version 2. Approve it to send.");
    setLocaleForTest("pl");
    expect(t("appr_edit_saved", { n: 2 })).toBe("Zapisano jako wersję 2. Zatwierdź ją, aby wysłać.");
  });

  test("409 changed keeps the text and offers the new version; with no id it offers none", () => {
    expect(editOutcome(failure(409, "changed", { error: "changed", currentId: NEWEST }))).toEqual({
      kind: "changed",
      currentId: NEWEST,
    });
    expect(editOutcome(failure(409, "changed"))).toEqual({ kind: "changed", currentId: null });
    expect(en.appr_edit_changed).toBe("Someone changed this draft. Copy your text, then open the new version.");
    expect(en.appr_edit_open_new).toBe("Open the new version");
  });

  test("409 closed has one text for each state and each edit code", () => {
    const keys = [...approvalClosedStates, ...approvalEditClosedCodes].map((state) => {
      const outcome = editOutcome(failure(409, "closed", { error: "closed", state }));
      expect(outcome.kind).toBe("closed");
      return outcome.kind === "closed" ? outcome.key : "";
    });
    expect(new Set(keys).size).toBe(approvalClosedStates.length + approvalEditClosedCodes.length);
    expect(keys).not.toContain("appr_closed_other");
  });

  test("409 drafts_off, 400 unchanged, delegate_inactive and not_editable have their texts", () => {
    expect(editOutcome(failure(409, "drafts_off"))).toEqual({ kind: "message", key: "appr_edit_drafts_off" });
    expect(editOutcome(failure(400, "unchanged"))).toEqual({ kind: "message", key: "appr_edit_unchanged" });
    expect(editOutcome(failure(400, "delegate_inactive"))).toEqual({
      kind: "message",
      key: "appr_edit_delegate_inactive",
    });
    expect(editOutcome(failure(400, "not_editable"))).toEqual({ kind: "message", key: "appr_edit_not_editable" });
    expect(en.appr_edit_drafts_off).toBe("Edits need assist mode with drafts on.");
    expect(en.appr_edit_unchanged).toBe("Nothing changed.");
    expect(en.appr_edit_delegate_inactive).toBe("This delegate is no longer active.");
  });

  test("400 validation names the field that failed; a path that is no field gets the general error", () => {
    const at = (path: string) =>
      failure(400, "validation", { error: "validation" }, [{ path, code: "custom", message: "x" }]);
    expect(editOutcome(at("subject"))).toEqual({
      kind: "field",
      field: "subject",
      key: "appr_edit_subject_error",
      max: EDIT_SUBJECT_MAX,
    });
    expect(editOutcome(at("body"))).toEqual({
      kind: "field",
      field: "body",
      key: "appr_edit_body_error",
      max: EDIT_BODY_MAX,
    });
    expect(editOutcome(at("delegateId")).kind).toBe("error");
    expect(editOutcome(failure(400, "validation")).kind).toBe("error");
  });

  test("404 means the send is gone; a network error and an unknown answer get the general error", () => {
    expect(editOutcome(failure(404, "not_found"))).toEqual({ kind: "gone" });
    expect(editOutcome(new Error("offline")).kind).toBe("error");
    expect(editOutcome(failure(500, "internal")).kind).toBe("error");
    expect(editOutcome(failure(409, "closed", { error: "closed", state: "nonsense" })).kind).toBe("error");
  });

  test("every new text exists in both languages, and the Polish one is not a copy of the English one", () => {
    const keys = Object.keys(en).filter((key) => key.startsWith("appr_edit") || key.startsWith("appr_closed_"));
    expect(keys.length).toBeGreaterThanOrEqual(20);
    for (const key of keys as (keyof typeof en)[]) {
      expect(pl[key], key).not.toBe("");
      if (key.startsWith("appr_edit") && key !== "appr_edit_count") expect(pl[key], key).not.toBe(en[key]);
    }
    expect(en.appr_closed_draft_gone).toBe("The text of this draft is no longer stored. It cannot be edited.");
    expect(pl.appr_closed_draft_gone).toBe("Treść tego szkicu nie jest już zapisana. Nie można go edytować.");
    expect(pl.appr_edit_discard_title).toBe("Porzucić zmiany?");
    expect(pl.appr_edit_keep).toBe("Wróć do edycji");
  });
});
