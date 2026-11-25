/// <reference types="bun" />
import type { ApprovalDetail } from "@ea/core/web";
import { afterEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ApprovalEditForm } from "../components/approvals/ApprovalEditForm";
import { setLocaleForTest } from "../i18n";
import { editStart, saveState } from "./approvals-edit";

afterEach(() => setLocaleForTest("en"));

const SEND = "0190f5a0-0000-7000-8000-0000000000a1";

const detail = (patch: Partial<ApprovalDetail> = {}): ApprovalDetail => ({
  id: SEND,
  mailboxAddress: "box@x.test",
  createdAt: "2026-11-20T10:00:00.000Z",
  delegationId: null,
  setId: null,
  version: 1,
  state: "waiting",
  draftReady: true,
  kind: "delegation",
  expiresAt: "2026-11-22T12:00:00.000Z",
  heldBy: null,
  view: {
    kind: "delegation",
    recipient: { name: "Anna Nowak", address: "anna@example.com" },
    sender: { label: "Boss <boss@example.net>", external: true },
    recipientInactive: false,
    subject: "Budget",
    dueDate: "2026-11-25",
    body: "Line one\nLine two",
    quote: { text: "> quoted\n> text", cut: false },
    synthetic: false,
  },
  draftRemovable: true,
  currentId: null,
  quote: "From: Boss\n\nFull quote text",
  delegates: [],
  ...patch,
});

describe("ApprovalEditForm", () => {
  const delegates = [
    { id: "0190f5a0-0000-7000-8000-0000000000d1", name: "Anna Nowak", email: "anna@example.com" },
    { id: "0190f5a0-0000-7000-8000-0000000000d2", name: "Piotr Lis", email: "piotr@example.com" },
  ];
  const form = (patch: Partial<ApprovalDetail> = {}) => {
    const d = detail({ delegationId: "0190f5a0-0000-7000-8000-0000000000e1", delegates, ...patch });
    const start = editStart(d);
    if (start === null) throw new Error("the detail must be editable");
    return renderToStaticMarkup(
      <ApprovalEditForm
        detail={d}
        values={start}
        state={saveState(start, start)}
        pending={false}
        problem={null}
        onChange={() => undefined}
        onSubmit={() => undefined}
        onCancel={() => undefined}
        onOpenNewest={() => undefined}
      />
    );
  };

  test("a delegation names its subject field, its body field and its delegate select by their labels", () => {
    const html = form();
    expect(html).toMatch(/<label[^>]*for="approval-edit-subject"[^>]*>Subject<\/label>/);
    expect(html).toMatch(/<input[^>]*id="approval-edit-subject"[^>]*value="Budget"/);
    expect(html).toMatch(/<label[^>]*for="approval-edit-body"[^>]*>Body<\/label>/);
    expect(html).toMatch(/<textarea[^>]*id="approval-edit-body"/);
    expect(html).toMatch(/<label[^>]*for="approval-edit-delegate"[^>]*>Delegate<\/label>/);
    expect(html).toMatch(/<button[^>]*role="combobox"[^>]*id="approval-edit-delegate"/);
    expect(html).toContain("17 of 3000 characters");
  });

  test("a mail with no delegate list has no delegate select", () => {
    expect(form({ kind: "reply", delegationId: null, delegates: [] })).not.toContain("approval-edit-delegate");
  });

  test("Save is the filled button and Cancel the quiet one; the two notes sit in fact boxes", () => {
    const html = form({ draftRemovable: false });
    expect(html).toMatch(/data-variant="ghost"[^>]*type="button"[^>]*>Cancel<\/button>/);
    expect(html).toMatch(/data-variant="default"[^>]*type="submit"[^>]*>Save<\/button>/);
    expect(html.match(/data-slot="fact-box"/g)).toHaveLength(2);
    expect(form()).toMatch(/fact-box[^]*The quoted mail is added below your text\./);
  });
});
