/// <reference types="bun" />
import type { ApprovalDetail, ApprovalItem } from "@ea/core/web";
import { afterEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ApprovalActions, reasonChoice } from "../components/approvals/ApprovalActions";
import { ApprovalDetailPanel } from "../components/approvals/ApprovalDetailPanel";
import { ApprovalList } from "../components/approvals/ApprovalList";
import { ApprovalSummary } from "../components/approvals/ApprovalSummary";
import { BottomTabs, Sidebar } from "../components/shell/Nav";
import { setLocaleForTest } from "../i18n";

afterEach(() => setLocaleForTest("en"));

const NOW = new Date("2026-11-20T12:00:00.000Z");
const SEND = "0190f5a0-0000-7000-8000-0000000000a1";

type View = NonNullable<ApprovalDetail["view"]>;

const view = (patch: Partial<View> = {}): View => ({
  kind: "delegation",
  recipient: { name: "Anna Nowak", address: "anna@example.com" },
  sender: { label: "Boss <boss@example.net>", external: true },
  recipientInactive: false,
  subject: "Budget",
  dueDate: "2026-11-25",
  body: "Line one\nLine two",
  quote: { text: "> quoted\n> text", cut: false },
  synthetic: false,
  ...patch,
});

const item = (patch: Partial<Parameters<typeof ApprovalSummary>[0]["item"]> = {}) => ({
  state: "waiting" as const,
  draftReady: true,
  heldBy: null,
  expiresAt: "2026-11-22T11:00:00.000Z",
  view: view(),
  ...patch,
});

// The markup without the `bdi` tags that isolate each address: the tests of the words read the text.
const plain = (html: string) => html.replace(/<\/?bdi>/g, "");

const summary = (patch: Parameters<typeof item>[0] = {}) =>
  renderToStaticMarkup(<ApprovalSummary item={item(patch)} now={NOW} />);

describe("ApprovalSummary sender line", () => {
  const sender = { relation: "vip", received: 8, answered: 6, userMailsTo: 3, lastSeenDaysAgo: 2, days: 90 } as const;

  test("shows the line below the From line; no line with null or no key", () => {
    const html = summary({ sender });
    expect(html).toContain(
      "VIP · you answered 6 of 8 mails in 90 days · you wrote to them 3 times · last mail 2 days ago"
    );
    expect(html.indexOf("From:")).toBeLessThan(html.indexOf("you answered"));
    expect(summary({ sender: null })).not.toContain("you answered");
    expect(summary()).not.toContain("you answered");
  });

  test("the Polish page has its own words", () => {
    setLocaleForTest("pl");
    expect(summary({ sender })).toContain("odpowiedź na 6 z 8 wiadomości w 90 dni");
  });
});

describe("ApprovalSummary of a follow-up (F116 stage 11)", () => {
  const followUp = (patch: Partial<View> = {}) =>
    plain(
      summary({
        view: view({
          kind: "follow_up",
          recipient: { name: null, address: "anna@example.test" },
          sender: null,
          dueDate: null,
          to: ["anna@example.test", "boss@example.test"],
          cc: ["jan@example.test", "ewa@example.test"],
          followUpNumber: 2,
          ...patch,
        }),
      })
    );

  test("spells out every To and Cc address and the number, and has no From line", () => {
    const html = followUp();
    expect(html).toContain("To: anna@example.test, boss@example.test");
    expect(html).toContain("Cc: jan@example.test, ewa@example.test");
    expect(html).toContain("Follow-up 2 of 2");
    expect(html).not.toContain("From:");
  });

  test("no Cc line without a Cc; the Polish page has its own words", () => {
    expect(followUp({ cc: [] })).not.toContain("Cc:");
    setLocaleForTest("pl");
    const html = followUp();
    expect(html).toContain("Do: anna@example.test, boss@example.test");
    expect(html).toContain("Kopia: jan@example.test, ewa@example.test");
    expect(html).toContain("Przypomnienie 2 z 2");
    expect(html).not.toContain("Follow-up");
  });

  test("an address is text, never markup", () => {
    expect(followUp({ cc: ["<img src=x onerror=alert(1)>@x.test"] })).toContain(
      "&lt;img src=x onerror=alert(1)&gt;@x.test"
    );
  });
});

describe("ApprovalSummary", () => {
  test("shows the title with the recipient spelled out, the sender warning, the subject, the due date and the time left", () => {
    const html = summary();
    expect(html).toContain("Delegation to <bdi>Anna Nowak &lt;anna@example.com&gt;</bdi>");
    expect(html).toContain("From: Boss &lt;boss@example.net&gt;");
    expect(html).toContain("External sender");
    expect(html).toContain("Subject: Budget");
    expect(html).toContain("Due: 2026-11-25");
    expect(html).toContain("Waits for approval · Expires in 47 h");
    expect(html).not.toContain("Version");
    expect(html).not.toContain("Preparing");
  });

  test("an inactive delegate, a version from 2 on, a draft in the making and an unknown sender", () => {
    const html = summary({
      draftReady: false,
      view: view({
        recipientInactive: true,
        version: 3,
        sender: { label: "(unknown sender)", external: false },
      }),
    });
    expect(html).toContain("(inactive)");
    expect(html).toContain("Version 3");
    expect(html).toContain("Preparing the draft…");
    expect(html).toContain("From: (unknown sender)");
    expect(html).not.toContain("External sender");
    expect(summary({ view: view({ version: 1 }) })).not.toContain("Version");
  });

  test("a held send names its cause; with no cause it says sending soon", () => {
    expect(summary({ state: "held", heldBy: "scope" })).toContain(
      "Approved, held · Sending is held by SEND_SCOPE on the server"
    );
    const soon = summary({ state: "held", heldBy: null });
    expect(soon).toContain("Approved, sending soon");
    expect(soon).not.toContain("SEND_SCOPE");
  });

  test("the Polish summary has no English text", () => {
    setLocaleForTest("pl");
    const html = plain(summary({ state: "held", heldBy: null }));
    expect(html).toContain("Zlecenie: Anna Nowak");
    expect(html).toContain("Nadawca zewnętrzny");
    expect(html).toContain("Zatwierdzone, wkrótce zostanie wysłane");
    expect(html).toContain("Wygasa za 47 godz.");
    expect(html).not.toContain("Delegation");
    expect(html).not.toContain("External");
  });
});

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
  view: view(),
  draftRemovable: true,
  currentId: null,
  quote: "From: Boss\n\nFull quote text",
  delegates: [],
  ...patch,
});

describe("ApprovalDetailPanel", () => {
  const render = (patch: Partial<ApprovalDetail> = {}) =>
    renderToStaticMarkup(
      <ApprovalDetailPanel detail={detail(patch)} now={NOW}>
        <span>ACTIONS</span>
      </ApprovalDetailPanel>
    );

  test("shows the body and the full quote as plain text with the note and the actions", () => {
    const html = render();
    // Line breaks stay: each text sits in a paragraph that keeps white space.
    expect(html).toMatch(/whitespace-pre-wrap[^"]*">Line one\nLine two<\/p>/);
    expect(html).toMatch(/whitespace-pre-wrap[^"]*">From: Boss\n\nFull quote text<\/p>/);
    expect(html).not.toContain("&gt; quoted");
    expect(html).toContain("The system sends it after your approval. Do not send the draft from your mail client.");
    expect(html).toContain("Mailbox: box@x.test");
    expect(html).toContain("ACTIONS");
  });

  test("a mail text is never read as markup", () => {
    const html = render({ view: view({ body: "<script>alert(1)</script>" }) });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  test("without the full quote the cut quote of the view shows with its note", () => {
    const html = render({ quote: null, view: view({ quote: { text: "cut quote", cut: true } }) });
    expect(html).toContain("cut quote");
    expect(html).toContain("The quote is cut.");
  });

  test("a send that retention cleared has no text and still shows its state; a closed send has no send note", () => {
    const cleared = render({ view: null, kind: null, version: null, expiresAt: null, state: "sent" });
    expect(cleared).toContain("The text of this draft was removed.");
    expect(cleared).toContain("Sent");
    expect(cleared).not.toContain("Line one");
    expect(render({ state: "sent", expiresAt: null })).not.toContain("The system sends it after your approval");
  });

  test("a closed send with no deadline shows no expiry line", () => {
    for (const state of ["sent", "rejected"] as const) {
      const html = render({ state, expiresAt: null });
      expect(html).not.toContain("Expires in");
      expect(html).not.toContain("NaN");
    }
  });
});

describe("RejectReason", () => {
  test("Skip saves no reason; a reason is passed on; an unknown value does nothing", () => {
    expect(reasonChoice("skip")).toBeNull();
    expect(reasonChoice("wrong_person")).toBe("wrong_person");
    expect(reasonChoice("not_needed")).toBe("not_needed");
    expect(reasonChoice("other")).toBeUndefined();
  });
});

describe("ApprovalActions", () => {
  const props = {
    draftReady: true,
    busy: false,
    ownerOnly: false,
    canEdit: false,
    onApprove: () => undefined,
    onReject: () => undefined,
    onEdit: () => undefined,
  };
  const buttons = (html: string) => [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((match) => match[1]);

  test("an owner gets Approve and Reject on a waiting send, only Reject on a held one, none otherwise", () => {
    expect(
      buttons(renderToStaticMarkup(<ApprovalActions {...props} decisions={{ approve: true, reject: true }} />))
    ).toEqual(["Approve", "Reject"]);
    expect(
      buttons(renderToStaticMarkup(<ApprovalActions {...props} decisions={{ approve: false, reject: true }} />))
    ).toEqual(["Reject"]);
    expect(
      buttons(renderToStaticMarkup(<ApprovalActions {...props} decisions={{ approve: false, reject: false }} />))
    ).toEqual([]);
  });

  test("Edit shows only when the page allows it, after Reject, and is off while a request runs", () => {
    const decisions = { approve: true, reject: true };
    expect(buttons(renderToStaticMarkup(<ApprovalActions {...props} decisions={decisions} canEdit />))).toEqual([
      "Approve",
      "Reject",
      "Edit",
    ]);
    expect(buttons(renderToStaticMarkup(<ApprovalActions {...props} decisions={decisions} />))).not.toContain("Edit");
    const busy = renderToStaticMarkup(<ApprovalActions {...props} busy decisions={decisions} canEdit />);
    expect(busy.match(/disabled=""/g)).toHaveLength(3);
    // A member sees no Edit even when the flag is set by mistake: the owner note replaces every button.
    expect(
      buttons(renderToStaticMarkup(<ApprovalActions {...props} ownerOnly decisions={decisions} canEdit />))
    ).toEqual([]);
  });

  test("a member gets no button and is told why", () => {
    const html = renderToStaticMarkup(
      <ApprovalActions {...props} ownerOnly decisions={{ approve: false, reject: false }} />
    );
    expect(buttons(html)).toEqual([]);
    expect(html).toContain("Only the owner can do this.");
  });

  test("the buttons are disabled while a request runs; Approve is disabled while the draft is not ready", () => {
    const decisions = { approve: true, reject: true };
    const busy = renderToStaticMarkup(<ApprovalActions {...props} busy decisions={decisions} />);
    expect(busy.match(/disabled=""/g)).toHaveLength(2);
    const notReady = renderToStaticMarkup(<ApprovalActions {...props} draftReady={false} decisions={decisions} />);
    expect(notReady.match(/disabled=""/g)).toHaveLength(1);
    expect(renderToStaticMarkup(<ApprovalActions {...props} decisions={decisions} />)).not.toContain('disabled=""');
  });
});

describe("ApprovalList", () => {
  const listItem = (id: string): ApprovalItem => ({
    id,
    version: 1,
    state: "waiting",
    draftReady: true,
    kind: "delegation",
    mailboxAddress: "box@x.test",
    createdAt: "2026-11-20T10:00:00.000Z",
    delegationId: null,
    setId: null,
    expiresAt: "2026-11-22T11:00:00.000Z",
    heldBy: null,
    view: view(),
  });

  test("every item is a link to its own id; the selected one is marked", () => {
    const first = listItem(SEND);
    const second = listItem("0190f5a0-0000-7000-8000-0000000000a2");
    const html = renderToStaticMarkup(
      <ApprovalList items={[first, second]} selectedId={second.id} now={NOW} onSelect={() => undefined} />
    );
    expect(html).toContain(`href="/approvals?id=${first.id}"`);
    expect(html).toContain(`href="/approvals?id=${second.id}"`);
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Drafts that wait for approval"');
  });
});

describe("the nav badge", () => {
  const nav = {
    active: "activity" as const,
    onboardingOpen: false,
    operator: false,
    features: ["approvals_page"],
    email: null,
    loading: false,
    onLogOut: () => undefined,
  };

  // The text of the badge for 0, 1 and 100, and the name that a screen reader reads.
  test("hidden at 0, the number for 1, 99+ above 99; the screen reader text names the count", () => {
    const at = (count: number) => renderToStaticMarkup(<Sidebar {...nav} approvalsWaiting={count} />);
    expect(at(0)).not.toContain("waiting");
    expect(at(1)).toContain(">1</span>");
    expect(at(1)).toContain("1 waiting");
    expect(at(100)).toContain(">99+</span>");
    expect(at(100)).toContain("99+ waiting");
    const tabs = renderToStaticMarkup(
      <BottomTabs active="activity" features={["approvals_page"]} approvalsWaiting={1} />
    );
    expect(tabs).toContain("1 waiting");
  });

  test("no approvals item and no badge while the flag is off", () => {
    const html = renderToStaticMarkup(<Sidebar {...nav} features={[]} approvalsWaiting={5} />);
    expect(html).not.toContain("/approvals");
    expect(html).not.toContain("waiting");
  });

  test("the Polish badge reads the count", () => {
    setLocaleForTest("pl");
    expect(renderToStaticMarkup(<Sidebar {...nav} approvalsWaiting={3} />)).toContain("Oczekuje: 3");
  });
});
