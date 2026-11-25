/// <reference types="bun" />
import type { LoopItem } from "@ea/core/web";
import { afterEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { LOOP_ROW_BY_KIND } from "../components/loops/loop-kinds";
import type { LoopRowProps } from "../components/loops/LoopRow";
import { LoopFilterTabs, LoopTabs } from "../components/loops/LoopTabs";
import { LoopEmpty } from "../components/loops/LoopsBoard";
import { setLocaleForTest } from "../i18n";

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
  dueSource: "stated",
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

const noop = () => undefined;
const NOW = new Date("2026-11-20T08:00:00.000Z");
const row = (item: LoopItem, props: Partial<LoopRowProps> = {}) => {
  const Row = LOOP_ROW_BY_KIND[item.kind];
  return renderToStaticMarkup(
    <ul>
      <Row item={item} owner={true} canWrite={true} timeZone="Europe/Warsaw" now={NOW} onAction={noop} {...props} />
    </ul>
  );
};

describe("a loop row", () => {
  test("a waiting row shows the counterpart, the text, the reason, the stated due date and the follow-ups", () => {
    const html = row(loop());
    for (const text of [
      "client@example.com",
      "Send the offer",
      "You asked a question; no answer for 4 working days.",
      "Due 20 Nov 2026 (stated in your mail)",
      "Follow-ups: 0 of 2",
    ]) {
      expect(html).toContain(text);
    }
    expect(html).toContain(">Open<");
  });

  test("a default due date says so", () => {
    expect(row(loop({ dueSource: "default" }))).toContain("Due 20 Nov 2026 (default wait)");
  });

  test("a due date from the usual reply time says so and shows the usual reply under it, in both languages", () => {
    const contact = loop({ dueSource: "contact", usualReplyDays: 2 });
    const en = row(contact);
    expect(en).toContain("Due 20 Nov 2026 (usual reply time of this contact)");
    expect(en).toContain("Usual reply: 2 days");
    expect(row(loop({ dueSource: "contact", usualReplyDays: 1 }))).toContain("Usual reply: 1 day<");
    expect(row(loop({ dueSource: "default" }))).not.toContain("Usual reply");
    setLocaleForTest("pl");
    const pl = row(contact);
    expect(pl).toContain("zwykły czas odpowiedzi tej osoby");
    expect(pl).toContain("Zwykle odpowiada w 2 dni");
  });

  test("an owner gets a row with the initials of the counterpart and named buttons in the order of the rules; ids let the page return the focus", () => {
    const html = row(loop());
    expect(html).toMatch(/data-slot="initials-avatar"[^>]*>C</);
    const labels = [
      "Draft follow-up: client@example.com, Send the offer",
      "Later: client@example.com, Send the offer",
      "Done: client@example.com, Send the offer",
      "Drop: client@example.com, Send the offer",
    ];
    let at = 0;
    for (const label of labels) {
      const found = html.indexOf(`aria-label="${label}"`);
      expect(found).toBeGreaterThan(at);
      at = found;
    }
    expect(html).not.toContain("Stop tracking");
    expect(html).toContain('id="loop-follow_up-0190f5a0-0000-7000-8000-0000000000a1"');
    expect(html).not.toContain('aria-disabled="true"');
  });

  test("a member sees Later and Done only", () => {
    const html = row(loop(), { owner: false });
    expect(html).toContain('aria-label="Later: client@example.com, Send the offer"');
    expect(html).toContain('aria-label="Done: client@example.com, Send the offer"');
    expect(html).not.toContain("Draft follow-up");
    expect(html).not.toContain('aria-label="Drop');
  });

  test("a suspended organization shows no button", () => {
    expect(row(loop(), { canWrite: false })).not.toContain("<button");
  });

  test("a follow-up that waits hides the button and links the approval", () => {
    const sendId = "0190f5a0-0000-7000-8000-0000000000f1";
    const html = row(loop({ followUpWaiting: true, sendId }));
    expect(html).toContain("A follow-up waits for your approval.");
    expect(html).toContain(`href="/approvals?id=${sendId}"`);
    expect(html).toContain("Open the follow-up");
    expect(html).not.toContain("Draft follow-up");
    // A member sees the notice and the link too.
    expect(row(loop({ followUpWaiting: true, sendId }), { owner: false })).toContain(`href="/approvals?id=${sendId}"`);
  });

  test("two follow-ups sent: the button is off with the reason on screen", () => {
    const html = row(loop({ followUpsSent: 2 }));
    expect(html).toContain("Follow-ups: 2 of 2");
    expect(html).toMatch(/aria-label="Draft follow-up: client@example.com, Send the offer"[^>]*aria-disabled="true"/);
    expect(html).toContain("Two follow-ups were drafted already: no more.");
    expect(html).toContain("aria-describedby=");
  });

  test("a promise has no follow-up count, no Later and no follow-up button", () => {
    const html = row(loop({ kind: "promised", reason: "promised", laterLeft: 3 }));
    expect(html).toContain("You promised this in your sent mail.");
    expect(html).not.toContain("Follow-ups:");
    expect(html).not.toContain('aria-label="Later');
    expect(html).toContain('aria-label="Drop: client@example.com, Send the offer"');
  });

  test("a delegated row names the delegate, shows the address, and an owner can stop tracking", () => {
    const html = row(
      loop({
        kind: "delegated",
        reason: "forwarded_to_delegate",
        delegate: { id: "0190f5a0-0000-7000-8000-0000000000d1", name: "Anna Nowak" },
        counterpart: "anna@example.com",
      })
    );
    expect(html).toContain("Anna Nowak");
    expect(html).toContain("anna@example.com");
    expect(html).toContain("You forwarded this to a delegate; no answer for 4 working days.");
    expect(html).toContain('aria-label="Stop tracking: Anna Nowak, Send the offer"');
  });

  test("a closed row says how it ended; a matched-by-subject row and an auto-reply-only row say so", () => {
    const closed = row(loop({ status: "closed", closeReason: "replied_subject", matchedBySubject: true }));
    expect(closed).toContain("Closed: a reply came in another thread.");
    expect(closed).toContain("Matched by subject");
    expect(closed).toContain(">Closed<");
    expect(closed).toContain('aria-label="Reopen: client@example.com, Send the offer"');
    expect(closed).not.toContain("Done:");
    const auto = row(loop({ autoReplyOnly: true }));
    expect(auto).toContain("Auto-reply only");
    expect(row(loop())).not.toContain("Auto-reply only");
    expect(row(loop())).not.toContain("Matched by subject");
  });

  test("the text falls back to the subject, then to a dash for the eye and a sentence for a screen reader", () => {
    expect(row(loop({ text: null }))).toContain("Offer");
    const cleared = row(loop({ text: null, subject: null, counterpart: null, status: "closed", closeReason: "done" }));
    expect(cleared).toContain("The text of this loop is no longer stored.");
    expect(cleared).toContain("—");
    expect(cleared).not.toContain("null");
    expect(cleared).not.toContain("Reopen");
  });

  test("Polish: the same facts in Polish, no gendered past tense", () => {
    setLocaleForTest("pl");
    const html = row(loop({ followUpsSent: 1 }));
    for (const text of [
      "Pytanie bez odpowiedzi. Czas oczekiwania: 4 dni robocze.",
      "Termin: 20 lis 2026 (podany w wiadomości)",
      "Przypomnienia o odpowiedzi: 1 z 2",
      'aria-label="Przygotuj przypomnienie: client@example.com, Send the offer"',
      'aria-label="Później: client@example.com, Send the offer"',
      'aria-label="Gotowe: client@example.com, Send the offer"',
      'aria-label="Porzuć: client@example.com, Send the offer"',
    ]) {
      expect(html).toContain(text);
    }
    expect(html).not.toMatch(/łeś|łaś/);
  });
});

describe("an empty loop list", () => {
  test.each([
    ["open", "Nothing is open here."],
    ["due", "Nothing is due today."],
    ["closed", "Nothing is closed here."],
  ] as const)("the %s filter shows its sentence as the one heading", (filter, text) => {
    const html = renderToStaticMarkup(<LoopEmpty filter={filter} headingLevel={2} />);
    expect(html.match(/<h[1-6][ >]/g)).toHaveLength(1);
    expect(html).toContain(`<h2 class="text-xl font-bold">${text}</h2>`);
    expect(renderToStaticMarkup(<LoopEmpty filter={filter} headingLevel={3} />)).toContain(
      `<h3 class="text-xl font-bold">${text}</h3>`
    );
    expect(html).not.toContain("<button");
  });
});

describe("LoopTabs and LoopFilterTabs", () => {
  test("three tab links with their own addresses; the current one is marked", () => {
    const html = renderToStaticMarkup(<LoopTabs current="promised" onSelect={noop} />);
    expect(html).toContain('href="/delegations"');
    expect(html).toContain('href="/delegations?tab=waiting"');
    expect(html).toContain('href="/delegations?tab=promised"');
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-current="page"[^>]*>Promised</);
    for (const label of ["Delegated", "Waiting", "Promised"]) expect(html).toContain(`>${label}<`);
  });

  test("three filter links keep the tab; the current one is marked", () => {
    const html = renderToStaticMarkup(<LoopFilterTabs tab="waiting" current="due" onSelect={noop} />);
    for (const filter of ["open", "due", "closed"])
      expect(html).toContain(`href="/delegations?tab=waiting&amp;filter=${filter}"`);
    expect(html).toMatch(/aria-current="page"[^>]*>Due today</);
    expect(html).toContain('aria-label="Filter open loops"');
    setLocaleForTest("pl");
    expect(renderToStaticMarkup(<LoopFilterTabs tab="waiting" current="due" onSelect={noop} />)).toContain(">Na dziś<");
  });
});
