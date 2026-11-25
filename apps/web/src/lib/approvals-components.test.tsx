/// <reference types="bun" />
import type { ApprovalDetail, ApprovalItem } from "@ea/core/web";
import { afterEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ApprovalActions, ApprovalOutcome, reasonChoice } from "../components/approvals/ApprovalActions";
import { ApprovalCard } from "../components/approvals/ApprovalCard";
import { ApprovalSummary, ApprovalTitle } from "../components/approvals/ApprovalSummary";
import { WaitingList } from "../components/approvals/WaitingList";
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

// The title and the facts of an item, as the card shows them.
const summary = (patch: Parameters<typeof item>[0] = {}) =>
  renderToStaticMarkup(
    <>
      <ApprovalTitle view={item(patch).view} />
      <ApprovalSummary item={item(patch)} now={NOW} />
    </>
  );

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

const SENDER_LINE = {
  relation: "vip",
  received: 8,
  answered: 6,
  userMailsTo: 3,
  lastSeenDaysAgo: 2,
  days: 90,
} as const;

describe("ApprovalCard", () => {
  const render = (patch: Partial<ApprovalDetail> = {}) =>
    renderToStaticMarkup(
      <ApprovalCard detail={detail(patch)} now={NOW}>
        <span>ACTIONS</span>
      </ApprovalCard>
    );

  test("a delegation card has one title with the recipient, the avatar letters and the region name", () => {
    const html = render({
      view: view({ recipient: { name: "Anna Nowak", address: "anna@example.com" } }),
    });
    expect(html.match(/<h2/g)).toHaveLength(1);
    expect(html).toMatch(
      /<h2[^>]*tabindex="-1"[^>]*>Delegation to <bdi>Anna Nowak &lt;anna@example.com&gt;<\/bdi><\/h2>/
    );
    expect(html).toContain('data-slot="initials-avatar"');
    expect(html).toMatch(/data-slot="initials-avatar"[^>]*>AN<\/span>/);
    expect(html).toContain('<section aria-label="Draft details"');
  });

  test("a reply shows its gaps before the body", () => {
    const html = render({ kind: "reply", view: view({ kind: "reply", gaps: ["date"] }) });
    expect(html).toContain("Fill these before you send");
    expect(html.indexOf("Fill these before you send")).toBeLessThan(html.indexOf("Line one"));
  });

  test("the fact box holds the sender line and a reply's request; no box when both are absent", () => {
    const withLine = render({ sender: SENDER_LINE });
    expect(withLine).toContain('data-slot="fact-box"');
    expect(withLine).toMatch(/<h3[^>]*>About this draft<\/h3>/);
    expect(withLine).toContain(
      "VIP · you answered 6 of 8 mails in 90 days · you wrote to them 3 times · last mail 2 days ago"
    );
    const reply = render({
      kind: "reply",
      view: view({ kind: "reply" }),
      sender: null,
      instruction: "shorter, please",
    });
    expect(reply).toContain("shorter, please");
    expect(reply).toContain('data-slot="fact-box"');
    // The request of a delegation is not a reply's request: nothing shows.
    expect(render({ sender: null, instruction: "shorter, please" })).not.toContain('data-slot="fact-box"');
    expect(render({ sender: null })).not.toContain('data-slot="fact-box"');
  });

  test("the fact box has its own words in Polish", () => {
    setLocaleForTest("pl");
    const html = render({ sender: SENDER_LINE });
    expect(html).toContain("O tym szkicu");
    expect(html).toContain("odpowiedź na 6 z 8 wiadomości w 90 dni");
  });

  test("an external sender shows the warning badge next to the From line", () => {
    const html = render();
    expect(html).toMatch(
      /From: Boss &lt;boss@example.net&gt;<span[^>]*data-variant="destructive"[^>]*>.*External sender/
    );
    expect(render({ view: view({ sender: { label: "Boss <boss@example.net>", external: false } }) })).not.toContain(
      "External sender"
    );
  });

  test("the quote is a closed disclosure for every kind", () => {
    const html = render();
    expect(html).toMatch(/<details[^>]*><summary[^>]*>Quoted original<\/summary>/);
    expect(html).not.toMatch(/<details[^>]* open/);
    expect(html).not.toMatch(/<h3[^>]*>Quoted original/);
  });

  test("shows the body and the full quote as plain text with the note and the actions", () => {
    const html = render();
    // Line breaks stay: each text sits in a paragraph that keeps white space.
    expect(html).toMatch(/whitespace-pre-wrap[^"]*">Line one\nLine two<\/p>/);
    expect(html).toMatch(/whitespace-pre-wrap[^"]*">From: Boss\n\nFull quote text<\/p>/);
    expect(html).toMatch(/whitespace-pre-wrap[^"]*bg-muted[^"]*">Line one/);
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

describe("a closed send", () => {
  test("shows its state and no time left, even when the route still sends a deadline", () => {
    const html = renderToStaticMarkup(
      <ApprovalSummary item={item({ state: "rejected", expiresAt: "2026-11-22T11:00:00.000Z" })} now={NOW} />
    );
    expect(html).toContain("Rejected");
    expect(html).not.toContain("Expires in");
  });
});

describe("ApprovalOutcome", () => {
  const base = { statusRef: null, reason: null };
  const buttons = (html: string) => [...html.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map((match) => match[1]);

  test("the result line replaces the three buttons; a failed approve adds Next draft", () => {
    const sent = renderToStaticMarkup(<ApprovalOutcome {...base} text="Sent to Anna Nowak." />);
    expect(sent).toContain('role="status"');
    expect(sent).toContain("Sent to Anna Nowak.");
    expect(buttons(sent)).toEqual([]);
    const failed = renderToStaticMarkup(
      <ApprovalOutcome {...base} text="Approved, but sending failed." onNext={() => undefined} />
    );
    expect(buttons(failed)).toEqual(["Next draft"]);
  });

  test("after a No the reason question shows until it is answered, then the saved line", () => {
    const asking = renderToStaticMarkup(
      <ApprovalOutcome {...base} text="Rejected." reason={{ saved: false, busy: false, onPick: () => undefined }} />
    );
    expect(asking).toContain("Why?");
    const saved = renderToStaticMarkup(
      <ApprovalOutcome {...base} text="Rejected." reason={{ saved: true, busy: false, onPick: () => undefined }} />
    );
    expect(saved).toContain("Reason saved.");
    expect(saved).not.toContain("Why?");
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
  // The text of each button, without its icon.
  const buttons = (html: string) =>
    [...html.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map((match) => (match[1] ?? "").replace(/<svg.*?<\/svg>/g, ""));

  test("an owner gets Yes and No on a waiting send, only No on a held one, none otherwise", () => {
    expect(
      buttons(renderToStaticMarkup(<ApprovalActions {...props} decisions={{ approve: true, reject: true }} />))
    ).toEqual(["Yes, send it", "No"]);
    expect(
      buttons(renderToStaticMarkup(<ApprovalActions {...props} decisions={{ approve: false, reject: true }} />))
    ).toEqual(["No"]);
    expect(
      buttons(renderToStaticMarkup(<ApprovalActions {...props} decisions={{ approve: false, reject: false }} />))
    ).toEqual([]);
  });

  test("Change shows only when the page allows it, between Yes and No, and is off while a request runs", () => {
    const decisions = { approve: true, reject: true };
    expect(buttons(renderToStaticMarkup(<ApprovalActions {...props} decisions={decisions} canEdit />))).toEqual([
      "Yes, send it",
      "Change",
      "No",
    ]);
    expect(buttons(renderToStaticMarkup(<ApprovalActions {...props} decisions={decisions} />))).not.toContain("Change");
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

  test("Yes and No are off for an expired draft and say why; Change stays on", () => {
    const html = renderToStaticMarkup(
      <ApprovalActions {...props} expired canEdit decisions={{ approve: true, reject: true }} />
    );
    expect(html.match(/disabled=""/g)).toHaveLength(2);
    expect(html).toContain("This draft expired. Nothing was sent.");
  });

  test("the buttons are disabled while a request runs; Yes is disabled while the draft is not ready", () => {
    const decisions = { approve: true, reject: true };
    const busy = renderToStaticMarkup(<ApprovalActions {...props} busy decisions={decisions} />);
    expect(busy.match(/disabled=""/g)).toHaveLength(2);
    const notReady = renderToStaticMarkup(<ApprovalActions {...props} draftReady={false} decisions={decisions} />);
    expect(notReady.match(/disabled=""/g)).toHaveLength(1);
    expect(renderToStaticMarkup(<ApprovalActions {...props} decisions={decisions} />)).not.toContain('disabled=""');
  });
});

describe("WaitingList", () => {
  const listItem = (id: string, patch: Partial<ApprovalItem> = {}): ApprovalItem => ({
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
    ...patch,
  });
  const ids = [SEND, "0190f5a0-0000-7000-8000-0000000000a2", "0190f5a0-0000-7000-8000-0000000000a3"] as const;

  test("every item is a link to its own id; the focused one is marked", () => {
    const html = renderToStaticMarkup(
      <WaitingList items={[listItem(ids[0]), listItem(ids[1])]} focusId={ids[1]} now={NOW} onPick={() => undefined} />
    );
    expect(html).toContain(`href="/approvals?id=${ids[0]}"`);
    expect(html).toContain(`href="/approvals?id=${ids[1]}"`);
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
    expect(html).toMatch(new RegExp(`href="/approvals\\?id=${ids[1]}" aria-current="true"`));
    expect(html).toContain('aria-label="Drafts that wait for approval"');
  });

  test("the held sends come after the waiting ones, under one heading", () => {
    const html = renderToStaticMarkup(
      <WaitingList
        items={[listItem(ids[0], { state: "held" }), listItem(ids[1]), listItem(ids[2])]}
        focusId={null}
        now={NOW}
        onPick={() => undefined}
      />
    );
    expect(html.match(/<a /g)).toHaveLength(3);
    expect(html.match(/Approved, not sent yet/g)).toHaveLength(1);
    expect(html.indexOf(`id=${ids[1]}`)).toBeLessThan(html.indexOf("Approved, not sent yet"));
    expect(html.indexOf(`id=${ids[2]}`)).toBeLessThan(html.indexOf("Approved, not sent yet"));
    expect(html.indexOf("Approved, not sent yet")).toBeLessThan(html.indexOf(`id=${ids[0]}`));
  });

  test("no held heading without a held send; a row shows the avatar, the title, the subject and the state line", () => {
    const html = renderToStaticMarkup(
      <WaitingList items={[listItem(ids[0])]} focusId={null} now={NOW} onPick={() => undefined} />
    );
    expect(html).not.toContain("Approved, not sent yet");
    expect(html).toMatch(/data-slot="initials-avatar"[^>]*>AN<\/span>/);
    expect(plain(html)).toContain("Delegation to Anna Nowak &lt;anna@example.com&gt;");
    expect(html).toContain("Budget");
    expect(html).toContain("Waits for approval · Expires in 47 h");
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
