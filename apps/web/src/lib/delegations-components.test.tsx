/// <reference types="bun" />
import type { DelegationItem } from "@ea/core/web";
import { afterEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { DelegationRow, type DelegationRowProps } from "../components/delegation/DelegationRow";
import { setLocaleForTest } from "../i18n";

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

const noop = () => undefined;
const row = (it: DelegationItem, props: Partial<DelegationRowProps> = {}) =>
  renderToStaticMarkup(
    <ul>
      <DelegationRow
        item={it}
        owner={true}
        canWrite={true}
        timeZone="Europe/Warsaw"
        blocked={undefined}
        onAction={noop}
        {...props}
      />
    </ul>
  );

describe("DelegationRow", () => {
  test("a sent row shows the delegate, the task, the subject, the due date and the reminder count, and no status badge", () => {
    const html = row(item());
    for (const text of ["Anna Nowak", "anna@example.com", "Send the numbers", "Subject: Budget", "Due 20 Nov 2026"]) {
      expect(html).toContain(text);
    }
    expect(html).toContain("Reminders: 0 of 2");
    expect(html).not.toContain(">Sent<");
  });

  test("a row in the closed list shows its status badge", () => {
    expect(row(item({ status: "done" }), { showStatus: true })).toContain(">Done<");
  });

  test("the card gives Remind now the soft look at full width, Done the outline look and Cancel the ghost look", () => {
    const buttons = row(item({ status: "overdue" })).match(/<button[^>]*>/g) ?? [];
    const [remind, done, cancel] = buttons;
    expect(buttons).toHaveLength(3);
    expect(remind).toContain('data-variant="soft"');
    expect(remind).toContain("w-full");
    expect(done).toContain('data-variant="outline"');
    expect(cancel).toContain('data-variant="ghost"');
  });

  test("an owner gets named Remind now and Cancel buttons on a sent row, and no Done", () => {
    const html = row(item());
    expect(html).toContain('aria-label="Remind now: Anna Nowak"');
    expect(html).toContain('aria-label="Cancel delegation: Anna Nowak"');
    expect(html).not.toContain("Mark as done");
    expect(html).not.toContain('aria-disabled="true"');
  });

  test("a member gets Done on an answered row, and no Remind now or Cancel", () => {
    const html = row(item({ status: "answered" }), { owner: false });
    expect(html).toContain('aria-label="Mark as done: Anna Nowak"');
    expect(html).not.toContain("Remind now");
    expect(html).not.toContain("Cancel delegation");
  });

  test("a suspended organization gets no button", () => {
    expect(row(item({ status: "overdue" }), { canWrite: false })).not.toContain("<button");
  });

  test("a waiting reminder disables Remind now, names the reason and links to Approvals", () => {
    const html = row(item({ reminderWaiting: true }));
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain("aria-describedby=");
    expect(html).toContain("A reminder already waits for your approval.");
    expect(html).toContain("A reminder waits for your approval.");
    expect(html).toContain('href="/approvals"');
    // The button is not `disabled`: a keyboard user can reach it and read the reason.
    expect(html).not.toMatch(/ disabled=""/);
  });

  test("each cause of the row gives its reason; the answer of the server adds `drafts_off`", () => {
    expect(row(item({ remindersSent: 2 }))).toContain("The limit of 2 reminders is reached.");
    expect(row(item({ delegate: { ...item().delegate, active: false } }))).toContain("This delegate is off.");
    expect(row(item(), { blocked: "drafts_off" })).toContain("Reminders need assist mode with drafts on.");
    expect(row(item())).not.toContain("Reminders need assist mode");
  });

  test("an inactive delegate shows Off next to the state", () => {
    expect(row(item({ delegate: { ...item().delegate, active: false } }))).toContain(">Off<");
    expect(row(item())).not.toContain(">Off<");
  });

  test("a task that retention cleared shows a dash and a sentence for a screen reader", () => {
    const html = row(item({ task: null }));
    expect(html).toContain('aria-hidden="true">—<');
    expect(html).toContain("The text of the task is no longer stored.");
  });

  test("null subject and due date show words, not 'null' or 'Invalid Date'", () => {
    const html = row(item({ subject: null, dueAt: null }));
    expect(html).toContain("Subject: No subject");
    expect(html).toContain("No due date");
    expect(html).not.toContain("null");
    expect(html).not.toContain("Invalid");
  });

  test("a drafted row links its draft to the approval", () => {
    const id = "0190f5a0-0000-7000-8000-0000000000f1";
    const html = row(item({ status: "drafted", sendId: id }));
    expect(html).toContain(`href="/approvals?id=${id}"`);
    expect(html).toContain("Open the draft");
    expect(html).not.toContain("Remind now");
    expect(row(item({ status: "sent", sendId: id }))).not.toContain("Open the draft");
  });

  test("Polish: wykonawca, plain words, the delegate name in the button label", () => {
    setLocaleForTest("pl");
    const html = row(item({ status: "overdue", reminderWaiting: true, remindersSent: 1 }), { showStatus: true });
    expect(html).toContain('aria-label="Przypomnij teraz: Anna Nowak"');
    expect(html).toContain('aria-label="Oznacz jako zrobione: Anna Nowak"');
    expect(html).toContain('aria-label="Anuluj zlecenie: Anna Nowak"');
    expect(html).toContain("Przypomnienia: 1 z 2");
    expect(html).toContain("Po terminie");
    expect(html).toContain("Przypomnienie już czeka na Twoje zatwierdzenie.");
  });
});
