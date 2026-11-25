/// <reference types="bun" />
import type { ApprovalDetail, Me } from "@ea/core/web";
import { afterEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { DraftReplyAction } from "../components/activity/DraftReplyAction";
import { ApprovalActions } from "../components/approvals/ApprovalActions";
import { ApprovalCard } from "../components/approvals/ApprovalCard";
import { ReplyControls } from "../components/approvals/ReplyControls";
import { MeContext } from "../components/shell/MeProvider";
import { setLocaleForTest } from "../i18n";
import { canEdit } from "./approvals-edit";

afterEach(() => setLocaleForTest("en"));

const NOW = new Date("2026-11-20T12:00:00.000Z");
const SEND = "0190f5a0-0000-7000-8000-0000000000a1";
const MAIL = "0190f5a0-0000-7000-8000-0000000000c1";

type View = NonNullable<ApprovalDetail["view"]>;

const replyView = (patch: Partial<View> = {}): View => ({
  kind: "reply",
  recipient: { name: null, address: "anna@client.test" },
  sender: { label: "Anna <anna@client.test>", external: true },
  recipientInactive: false,
  subject: "Re: Spotkanie",
  dueDate: null,
  body: "Dzień dobry,\n\nTak, wtorek pasuje.",
  quote: { text: "> Czy wtorek?", cut: false },
  synthetic: false,
  version: 2,
  ...patch,
});

const detail = (patch: Partial<ApprovalDetail> = {}, view: Partial<View> = {}): ApprovalDetail => ({
  id: SEND,
  mailboxAddress: "box@x.test",
  createdAt: "2026-11-20T10:00:00.000Z",
  delegationId: null,
  setId: null,
  version: 2,
  state: "waiting",
  draftReady: true,
  kind: "reply",
  expiresAt: "2026-11-25T10:00:00.000Z",
  heldBy: null,
  view: replyView(view),
  draftRemovable: true,
  currentId: null,
  quote: "> Czy wtorek?\n> O dziesiątej?",
  delegates: [],
  instruction: null,
  redraftsLeft: 5,
  recipientsMode: "from",
  ...patch,
});

// The `bdi` tags around the addresses are tested on their own; the other tests read the text.
const panelRaw = (d: ApprovalDetail) =>
  renderToStaticMarkup(
    <ApprovalCard detail={d} now={NOW}>
      {null}
    </ApprovalCard>
  );

const plain = (html: string) => html.replace(/<\/?bdi>/g, "");
const panel = (d: ApprovalDetail) => plain(panelRaw(d));

// The attribute, not the `disabled:` classes of the button styles.
const OFF = /\sdisabled=""/;
// The button "Yes, send it" with its icon.
const YES = /<button[^>]*>(?:<svg.*?<\/svg>)?Yes, send it<\/button>/;

const at = (html: string, text: string): number => {
  const index = html.indexOf(text);
  expect(index, text).toBeGreaterThanOrEqual(0);
  return index;
};

describe("the detail of a reply", () => {
  test("shows the facts in order: gaps, To, Cc, Reply-To, the version, the time left, the full body, the quote closed", () => {
    const html = panel(
      detail(
        {},
        {
          gaps: ["kwota", "termin"],
          to: ["anna@client.test"],
          cc: ["b@y.test", "c@z.test"],
          replyTo: ["office@client.test"],
        }
      )
    );
    const order = [
      "Fill these before you send",
      "kwota",
      "termin",
      "To: ",
      "Cc: ",
      "Reply-To: ",
      "Version 2",
      "Expires in",
      "Tak, wtorek pasuje.",
      "<details",
      "Quoted original",
    ].map((text) => at(html, text));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(html).toContain("b@y.test, c@z.test");
    // The quote is inside the closed `details`: it has no `open` attribute.
    expect(html).not.toMatch(/<details[^>]* open/);
  });

  test("no gaps block without a gap; a gap label is text, never markup", () => {
    expect(panel(detail({}, { gaps: [] }))).not.toContain("Fill these before you send");
    expect(panel(detail({}, { gaps: ["<img src=x onerror=alert(1)>"] }))).toContain(
      "&lt;img src=x onerror=alert(1)&gt;"
    );
  });

  test("a reply with no Cc still shows its To line; the Reply-To line only when the view has one", () => {
    const html = panel(detail());
    expect(html).toContain("To: ");
    expect(html).toContain("anna@client.test");
    expect(html).not.toContain("Reply-To: ");
  });

  test("who the draft goes to is said before Send, for each mode", () => {
    expect(panel(detail({ recipientsMode: "from" }))).toContain("This reply goes to the sender.");
    expect(panel(detail({ recipientsMode: "all" }))).toContain("get a copy (Cc)");
    expect(panel(detail({ recipientsMode: "reply_to" }))).toContain("Reply-To address of the mail, not to the sender");
    setLocaleForTest("pl");
    expect(panel(detail({ recipientsMode: "all" }))).toContain("Pozostali odbiorcy wiadomości dostaną kopię (DW).");
  });

  test("an address with a lookalike letter shows its domain as punycode and a mark, in To, Cc and Reply-To", () => {
    const html = panel(
      detail({}, { to: ["anna@clіent.test"], cc: ["b@exämple.com"], replyTo: ["office@clіent.test"] })
    );
    expect(html).toContain("anna@xn--clent-o2e.test");
    expect(html).toContain("b@xn--exmple-cua.com");
    expect(html).toContain("office@xn--clent-o2e.test");
    expect(html.match(/Check this address/g)?.length).toBe(3);
    expect(panel(detail({}, { to: ["anna@client.test"] }))).not.toContain("Check this address");
  });

  test("`sentVisible: false` says that the sent mail cannot be seen", () => {
    expect(panel(detail({}, { sentVisible: false }))).toContain(
      "I cannot see your sent mail; check you did not answer already."
    );
    expect(panel(detail())).not.toContain("I cannot see your sent mail");
  });

  test("the note says that an edit in the mail client is safe; another kind keeps the old note", () => {
    expect(panel(detail())).toContain("Edit here, or edit and send in your mail client.");
    const delegation = detail({ kind: "delegation" }, { kind: "delegation" });
    expect(panel(delegation)).toContain("Do not send the draft from your mail client.");
    expect(panel(delegation)).not.toContain("edit and send in your mail client");
    const checked = detail({ kind: "delegation" }, { kind: "delegation", copyCheck: true });
    expect(panel(checked)).toContain("Edit here, or edit and send in your mail client.");
  });

  test("every address and the title recipient stand in a `bdi`: a direction override cannot reverse the text around it", () => {
    const override = "\u202Eevil@client.test";
    const html = panelRaw(
      detail(
        {},
        {
          to: [override],
          cc: ["b@y.test"],
          replyTo: ["office@client.test"],
          recipient: { name: "\u202EAnna", address: "anna@client.test" },
        }
      )
    );
    expect(html).toContain(`<bdi>${override}</bdi>`);
    expect(html).toContain("<bdi>b@y.test</bdi>");
    expect(html).toContain("<bdi>office@client.test</bdi>");
    expect(html).toContain("Reply to <bdi>");
  });

  test("a draft that the system closed says why; a timeout and a send in another state say nothing more", () => {
    const expired = detail({ state: "expired", expiresAt: null, endReason: "newer_mail" });
    expect(panel(expired)).toContain("A newer mail arrived in this thread. Nothing was sent.");
    expect(panel({ ...expired, endReason: "answered" })).toContain(
      "You already answered this mail. The system sent nothing."
    );
    expect(panel({ ...expired, endReason: "draft_changed" })).toContain(
      "The copy of this draft was changed in your mail client."
    );
    expect(panel({ ...expired, endReason: undefined })).not.toContain("sent nothing");
    expect(panel({ ...expired, endReason: undefined })).not.toContain("Nothing was sent");
    setLocaleForTest("pl");
    expect(panel({ ...expired, endReason: "answered" })).toContain(
      "Na tę wiadomość już odpowiedziano. System nic nie wysłał."
    );
  });
});

describe("Approve and Edit of a reply", () => {
  const actions = (block: Parameters<typeof ApprovalActions>[0]["approveBlock"]) =>
    renderToStaticMarkup(
      <ApprovalActions
        decisions={{ approve: true, reject: true }}
        draftReady
        busy={false}
        ownerOnly={false}
        canEdit
        approveBlock={block}
        onApprove={() => undefined}
        onReject={() => undefined}
        onEdit={() => undefined}
      />
    );

  test("with a gap Approve is off and the reason is in the page and linked to the button", () => {
    const html = actions("rp_approve_gaps");
    const approve = YES.exec(html)?.[0] ?? "";
    expect(approve).toMatch(OFF);
    expect(approve).toMatch(/aria-describedby="/);
    expect(html).toContain("Approve is off while the draft has gaps.");
    const id = /aria-describedby="([^"]+)"/.exec(html)?.[1] ?? "";
    expect(html).toContain(`id="${id}"`);
  });

  test("with no gap Approve is on and no reason shows", () => {
    const html = actions(null);
    expect(html).not.toContain("Approve is off");
    expect(YES.exec(html)?.[0]).not.toMatch(OFF);
  });

  test("an owner may edit a waiting reply, not a held or an expired one", () => {
    const owner = { owner: true, canWrite: true };
    expect(canEdit({ state: "waiting", kind: "reply" }, owner)).toBe(true);
    expect(canEdit({ state: "held", kind: "reply" }, owner)).toBe(false);
    expect(canEdit({ state: "waiting", kind: "reply" }, { owner: false, canWrite: true })).toBe(false);
    expect(canEdit({ state: "waiting", kind: "reminder" }, owner)).toBe(false);
  });
});

describe("the controls of a reply", () => {
  const controlsRaw = (d: ApprovalDetail, props: { waiting?: boolean; busy?: boolean; text?: string } = {}) =>
    renderToStaticMarkup(
      <ReplyControls
        detail={d}
        initialText={props.text}
        waiting={props.waiting ?? false}
        busy={props.busy ?? false}
        onRedraft={() => undefined}
        onRecipients={() => undefined}
      />
    );
  const controls = (d: ApprovalDetail, props: { waiting?: boolean; busy?: boolean; text?: string } = {}) =>
    plain(controlsRaw(d, props));
  const buttonOf = (html: string, name: string) =>
    new RegExp(`<button[^>]*>(?:<svg[^]*?</svg>)?${name}</button>`).exec(html)?.[0] ?? "";

  test("the line field has a label, a counter and the redrafts left; Redraft is off while the line is empty", () => {
    const html = controls(detail({ redraftsLeft: 4 }));
    expect(html).toContain("Tell the assistant what to change");
    expect(html).toContain("0 / 300");
    expect(html).toContain("Redrafts left for this mail: 4");
    expect(buttonOf(html, "Redraft")).toMatch(OFF);
    expect(html).not.toContain("Drafting…");
  });

  test("a line turns Redraft on, unless a request waits, a call is on its way or no redraft is left", () => {
    const text = "tak na wtorek";
    expect(buttonOf(controls(detail(), { text }), "Redraft")).not.toMatch(OFF);
    expect(controls(detail(), { text })).toContain("13 / 300");
    expect(buttonOf(controls(detail(), { text, waiting: true }), "Redraft")).toMatch(OFF);
    expect(buttonOf(controls(detail(), { text, busy: true }), "Redraft")).toMatch(OFF);
    expect(buttonOf(controls(detail({ redraftsLeft: 0 }), { text }), "Redraft")).toMatch(OFF);
    expect(buttonOf(controls(detail(), { text: "x".repeat(301) }), "Redraft")).toMatch(OFF);
    expect(controls(detail(), { text: "x".repeat(301) })).toContain("301 / 300");
  });

  test("the addresses that Reply all adds stand in a `bdi` each", () => {
    const html = controlsRaw(detail({ replyAllAdds: ["b@y.test", "c@z.test"] }, { canReplyAll: true }));
    expect(html).toContain("<bdi>b@y.test</bdi>, <bdi>c@z.test</bdi>");
  });

  test("an item with no count reads as five redrafts left in the text and in the button", () => {
    const html = controls(detail({ redraftsLeft: undefined }), { text: "krócej" });
    expect(html).toContain("Redrafts left for this mail: 5");
    expect(buttonOf(html, "Redraft")).not.toMatch(OFF);
  });

  test("no redrafts left: the text says so and Redraft is off", () => {
    const html = controls(detail({ redraftsLeft: 0 }));
    expect(html).toContain("The limit of new versions for this mail is used up.");
    expect(html).not.toContain("Redrafts left for this mail:");
    expect(buttonOf(html, "Redraft")).toMatch(OFF);
    expect(/<input[^>]*>/.exec(html)?.[0]).toMatch(OFF);
  });

  test("while a request waits: Drafting… shows and the field and the button are off", () => {
    const html = controls(detail(), { waiting: true });
    expect(html).toContain("Drafting…");
    expect(html).toContain("animate-spin");
    expect(buttonOf(html, "Redraft")).toMatch(OFF);
    expect(/<input[^>]*>/.exec(html)?.[0]).toMatch(OFF);
  });

  test("Reply all lists the added addresses before the tap; Use Reply-To names the address", () => {
    const html = controls(
      detail(
        { replyAllAdds: ["b@y.test", "c@z.test"] },
        { canReplyAll: true, canUseReplyTo: true, replyTo: ["office@client.test"] }
      )
    );
    expect(html).toContain("Reply all");
    expect(html).toContain("Cc adds:");
    expect(html).toContain("b@y.test, c@z.test");
    // The hint stands before the button: the owner reads who is added before the tap.
    expect(html.indexOf("c@z.test")).toBeLessThan(html.indexOf("<button", html.indexOf("c@z.test")));
    expect(html.indexOf("Cc adds:")).toBeLessThan(html.indexOf(">Reply all</button>"));
    expect(html).toContain("Use Reply-To");
    expect(html).toContain("The reply goes to this address instead of the sender:");
    expect(html).toContain("office@client.test");
    expect(buttonOf(html, "Reply all")).toContain('aria-pressed="false"');
  });

  test("no button for a choice that the mail does not offer; a chosen mode shows as pressed and lists nothing to add", () => {
    const none = controls(detail());
    expect(none).not.toContain("Reply all");
    expect(none).not.toContain("Use Reply-To");
    const all = controls(detail({ recipientsMode: "all", replyAllAdds: undefined }, { canReplyAll: undefined }));
    expect(buttonOf(all, "Reply all")).toContain('aria-pressed="true"');
    expect(all).not.toContain("Cc adds:");
  });

  test("a call on its way turns the recipient buttons off", () => {
    const html = controls(detail({ replyAllAdds: ["b@y.test"] }, { canReplyAll: true }), { busy: true });
    expect(buttonOf(html, "Reply all")).toMatch(OFF);
  });

  test("the Polish page has its own words", () => {
    setLocaleForTest("pl");
    const html = controls(detail({ redraftsLeft: 3 }, { canReplyAll: true }));
    expect(html).toContain("Napisz asystentowi, co zmienić");
    expect(html).toContain("Napisz inaczej");
    expect(html).toContain("Odpowiedz wszystkim");
    expect(html).toContain("Pozostałe nowe wersje dla tej wiadomości: 3");
  });
});

describe("the Draft reply button of an activity row", () => {
  const baseMe: Me = {
    user: { id: "0190f5a0-0000-7000-8000-000000000001", email: "a@x.test", displayName: "Ann", locale: null },
    organization: {
      id: "0190f5a0-0000-7000-8000-000000000002",
      name: "Acme Test",
      timezone: "Europe/Warsaw",
      plan: "active",
      trialEndsAt: null,
      maxMailboxes: 2,
    },
    operatorContact: null,
    role: "owner",
    telegram: { available: false, linked: false, botUsername: null },
    onboarding: {
      mailbox: true,
      telegram: false,
      telegramAvailable: false,
      mode: false,
      rules: 0,
      trust: false,
      channel: false,
      report: false,
      done: false,
    },
    scopes: {
      triage: { kind: "off", reason: "env_off" },
      actions: { kind: "off", reason: "env_off" },
      send: { kind: "off", reason: "env_off" },
    },
    mailboxCount: 1,
    mailboxesInAuthError: 0,
    digestTimes: ["08:00"],
    terms: { accepted: true, current: "2026-11-12" },
    operator: false,
    features: ["reply_drafts"],
    signInMethod: "password",
    hasPassword: true,
    approvalsWaiting: 0,
  };
  const row = (reply: { sendId: string | null } | undefined) => ({ emailId: MAIL, subject: "Spotkanie", reply });
  const render = (me: Me, reply: { sendId: string | null } | undefined) =>
    renderToStaticMarkup(
      <MeContext.Provider value={{ me, error: null, loading: false, reload: () => undefined }}>
        <DraftReplyAction item={row(reply)} />
      </MeContext.Provider>
    );

  test("an owner sees the button on a mail with no draft and the link on a mail with one", () => {
    const button = render(baseMe, { sendId: null });
    expect(button).toContain("Draft reply");
    expect(button).toContain('aria-label="Draft reply: Spotkanie"');
    const link = render(baseMe, { sendId: SEND });
    expect(link).toContain(`href="/approvals?id=${SEND}"`);
    expect(link).toContain("Open the draft");
    expect(link).not.toContain("<button");
  });

  test("no key (flag off), a member and a suspended organization see nothing", () => {
    expect(render(baseMe, undefined)).toBe("");
    expect(render({ ...baseMe, role: "assistant" }, { sendId: null })).toBe("");
    expect(render({ ...baseMe, organization: { ...baseMe.organization, plan: "suspended" } }, { sendId: null })).toBe(
      ""
    );
  });

  test("the Polish page has its own words", () => {
    setLocaleForTest("pl");
    expect(render(baseMe, { sendId: null })).toContain("Szkic odpowiedzi");
    expect(render(baseMe, { sendId: SEND })).toContain("Otwórz szkic");
  });
});
