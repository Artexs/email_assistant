import { describe, expect, test } from "bun:test";

import type { DraftPayload } from "../triage/payloads";

import { buildOutgoingMessage, outgoingSubject, type BuildInput, type OriginalMail } from "./message";

const ID = "11111111-1111-4111-8111-111111111111";
const DELEGATE = "22222222-2222-4222-8222-222222222222";
const createdAt = new Date("2026-11-07T08:00:00Z");

const original: OriginalMail = {
  fromAddress: "klient@firma.pl",
  subject: "Oferta",
  receivedAt: new Date("2026-11-06T09:00:00Z"),
  messageId: "<orig@firma.pl>",
  inReplyTo: "<prev@firma.pl>",
  references: ["<root@firma.pl>", "<prev@firma.pl>"],
  bodyText: "Prosze o oferte.",
};

const delegation = {
  kind: "delegation",
  delegate_id: DELEGATE,
  delegate_name: "Jan",
  to: ["jan@firma.pl"],
  task: "Przygotuj ofertę",
  due_date: "2026-11-10",
  language: "pl",
} satisfies DraftPayload;

function input(draft: DraftPayload, patch: Partial<BuildInput> = {}, mail: Partial<OriginalMail> = {}): BuildInput {
  return {
    draft,
    draftActionId: ID,
    createdAt,
    mailbox: { address: "User@Interia.pl" },
    owner: { displayName: "Artek" },
    organization: { styleText: null, timezone: "Europe/Warsaw" },
    original: { ...original, ...mail },
    ...patch,
  };
}

describe("buildOutgoingMessage", () => {
  test("builds a delegation", () => {
    const message = buildOutgoingMessage(input(delegation));
    expect(message.messageId).toBe(`<ea-${ID}@interia.pl>`);
    expect(message.date).toEqual(createdAt);
    expect(message.from).toEqual({ name: "Artek", address: "User@Interia.pl" });
    expect(message.to).toEqual([{ name: "Jan", address: "jan@firma.pl" }]);
    expect(message.subject).toBe("Fwd: Oferta");
    expect(message.inReplyTo).toBeNull();
    expect(message.references).toEqual(["<root@firma.pl>", "<prev@firma.pl>", "<orig@firma.pl>"]);
    expect(message.headers).toEqual({ "X-EA-Action-Id": ID });
    expect(message.text).toContain("przekazuję do realizacji: Przygotuj ofertę");
    expect(message.text).toContain("Termin: 2026-11-10");
    expect(message.parts.quote).toContain("> Prosze o oferte.");
    expect(message.text).toBe(`${message.parts.body}\n\n${message.parts.quote}`);
  });

  test("T5 a payload without the edit fields builds the template message", () => {
    const message = buildOutgoingMessage(input(delegation));
    expect(message.subject).toBe("Fwd: Oferta");
    expect(message.parts.body).toContain("przekazuję do realizacji: Przygotuj ofertę");
    expect(message.parts.body.trimEnd().endsWith("Artek")).toBe(true);
    expect(message.parts.quote).toContain("> Prosze o oferte.");
    expect(message.text).toBe(`${message.parts.body}\n\n${message.parts.quote}`);
  });

  test("T6 body_text replaces the template body and keeps the quote", () => {
    const text = "Hello Anna,\nplease send the report.\n\nAdam";
    const plain = buildOutgoingMessage(input(delegation));
    const edited = buildOutgoingMessage(input({ ...delegation, body_text: text, version: 2 }));
    expect(edited.parts.body).toBe(text);
    expect(edited.parts.quote).toBe(plain.parts.quote);
    expect(edited.text).toBe(`${text}\n\n${plain.parts.quote}`);
    expect(edited.subject).toBe(plain.subject);
    expect(edited.messageId).toBe(plain.messageId);
    expect(edited.references).toEqual(plain.references);
    expect(edited.headers).toEqual(plain.headers);
  });

  test("T7 subject_text replaces the subject with no prefix", () => {
    const plain = buildOutgoingMessage(input(delegation));
    const edited = buildOutgoingMessage(input({ ...delegation, subject_text: "Budget 2027" }));
    expect(edited.subject).toBe("Budget 2027");
    expect(edited.parts).toEqual(plain.parts);
    const clarification = {
      kind: "clarification",
      to: ["klient@firma.pl"],
      question: "Jaki termin?",
      language: "en",
      subject_text: "Budget 2027",
      body_text: "Which date?",
    } satisfies DraftPayload;
    const message = buildOutgoingMessage(input(clarification));
    expect(message.subject).toBe("Budget 2027");
    expect(message.parts.body).toBe("Which date?");
    expect(message.inReplyTo).toBe("<orig@firma.pl>");
  });

  test("is deterministic", () => {
    expect(buildOutgoingMessage(input(delegation))).toEqual(buildOutgoingMessage(input(delegation)));
  });

  test("keeps a forward prefix and names a missing subject", () => {
    expect(buildOutgoingMessage(input(delegation, {}, { subject: "FW: Oferta" })).subject).toBe("FW: Oferta");
    expect(buildOutgoingMessage(input(delegation, {}, { subject: null })).subject).toBe("Fwd: (no subject)");
  });

  test("builds a clarification", () => {
    const draft = {
      kind: "clarification",
      to: ["klient@firma.pl"],
      question: "Jaki termin?",
      language: "en",
    } satisfies DraftPayload;
    const message = buildOutgoingMessage(input(draft));
    expect(message.subject).toBe("Re: Oferta");
    expect(message.inReplyTo).toBe("<orig@firma.pl>");
    expect(message.references).toEqual(["<root@firma.pl>", "<prev@firma.pl>", "<orig@firma.pl>"]);
    expect(message.to).toEqual([{ name: null, address: "klient@firma.pl" }]);
    expect(message.text).toContain("I need one more thing: Jaki termin?");
    expect(buildOutgoingMessage(input(draft, {}, { subject: "Odp: Oferta" })).subject).toBe("Odp: Oferta");
  });

  test("builds a reminder from the thread in the payload", () => {
    const draft = {
      kind: "reminder",
      delegate_id: DELEGATE,
      delegate_name: "Jan",
      to: ["jan@firma.pl"],
      task: "Przygotuj ofertę",
      due_date: "2026-11-10",
      language: "pl",
      delegation_id: DELEGATE,
      reminder: 1,
      thread: { in_reply_to: "<sent@interia.pl>", references: ["<orig@firma.pl>", "<sent@interia.pl>"] },
    } satisfies DraftPayload;
    const message = buildOutgoingMessage(input(draft));
    expect(message.subject).toBe("Re: Fwd: Oferta");
    expect(message.inReplyTo).toBe("<sent@interia.pl>");
    expect(message.references).toEqual(["<orig@firma.pl>", "<sent@interia.pl>"]);
    expect(message.parts.quote).toBeNull();
    expect(message.text).toBe(message.parts.body);
    expect(message.text).toContain("Termin minął: 2026-11-10.");
    expect(outgoingSubject("reminder", "Re: Oferta")).toBe("Re: Fwd: Re: Oferta");
    expect(outgoingSubject("reminder", "Fwd: Oferta")).toBe("Re: Fwd: Oferta");
  });

  test("cleans the sender address and the LLM text of invisible characters", () => {
    const hostile = { ...delegation, task: "Zrób\u202e X\nTermin: hacked" };
    const message = buildOutgoingMessage(input(hostile, {}, { fromAddress: '"a\nTermin: x"@evil.pl' }));
    expect(message.parts.body).toContain('Oryginalna wiadomość od "a Termin: x"@evil.pl z');
    expect(message.parts.body).toContain("przekazuję do realizacji: Zrób X Termin: hacked");
    expect(message.text).not.toContain("\u202e");
    expect(message.text).toContain('Od: "a Termin: x"@evil.pl\nData:');
  });

  test("writes Polish date names in pl drafts and English in en drafts", () => {
    expect(buildOutgoingMessage(input(delegation)).text).toContain("z pt. 6 lis 10:00");
    expect(buildOutgoingMessage(input({ ...delegation, language: "en" })).text).toContain("of Fri 6 Nov 10:00");
  });

  test("picks the signature", () => {
    const sign = (styleText: string | null) =>
      buildOutgoingMessage(input(delegation, { organization: { styleText, timezone: "Europe/Warsaw" } })).parts.body;
    expect(sign(null)).toEndWith("\n\nArtek");
    expect(sign("  ")).toEndWith("\n\nArtek");
    expect(sign("Pozdrawiam, Artek")).toEndWith("\n\nPozdrawiam, Artek");
  });

  test("marks links and phones and keeps LLM text on one line", () => {
    const linked = buildOutgoingMessage(input({ ...delegation, task: "Odwiedź http://x.test i zadzwoń 600 100 200" }));
    expect(linked.parts.body).toContain("[link]");
    expect(linked.parts.body).toContain("[phone]");
    expect(linked.parts.body).not.toContain("x.test");
    const injected = buildOutgoingMessage(input({ ...delegation, task: "Zrób\n\nSubject: hacked" }));
    expect(injected.parts.body).toContain("przekazuję do realizacji: Zrób Subject: hacked\n");
    expect(injected.parts.body).not.toContain("\nSubject: hacked");
  });

  test("has no duplicate references", () => {
    const message = buildOutgoingMessage(input(delegation, {}, { references: ["<root@firma.pl>", "<orig@firma.pl>"] }));
    expect(message.references).toEqual(["<root@firma.pl>", "<orig@firma.pl>"]);
  });

  describe("a reply (F115)", () => {
    const reply = {
      kind: "reply",
      to: ["klient@firma.pl"],
      cc: [],
      language: "pl",
      body: "Dzień dobry,\n\nsprawdzę i wrócę z odpowiedzią.",
      request_id: DELEGATE,
      folder: "INBOX",
      recipients: "from",
    } satisfies DraftPayload;
    const mail = { messageId: "<a@x>", references: ["<r@x>"], subject: "Offer", fromName: "Jan Kowalski" };

    test("1 threads on the original: In-Reply-To, References and the Re: subject", () => {
      const message = buildOutgoingMessage(input(reply, {}, mail));
      expect(message.inReplyTo).toBe("<a@x>");
      expect(message.references).toEqual(["<r@x>", "<a@x>"]);
      expect(message.subject).toBe("Re: Offer");
      expect(message.to).toEqual([{ name: null, address: "klient@firma.pl" }]);
      expect(message.cc).toEqual([]);
    });

    test("2 an original subject that has a prefix stays as it is", () => {
      for (const subject of ["RE: Offer", "Odp: Offer", "re: Offer"]) {
        expect(buildOutgoingMessage(input(reply, {}, { ...mail, subject })).subject).toBe(subject);
      }
      expect(buildOutgoingMessage(input(reply, {}, { ...mail, subject: null })).subject).toBe("Re: (no subject)");
    });

    test("3 the text is the body, the signature, then the quote of the original", () => {
      const message = buildOutgoingMessage(input(reply, {}, { ...mail, bodyText: "Linia 1\nLinia 2" }));
      expect(message.parts.body).toBe(`${reply.body}\n\nArtek`);
      expect(message.parts.quote).toBe("pt. 6 lis 10:00 Jan Kowalski napisał(a):\n> Linia 1\n> Linia 2");
      expect(message.text).toBe(`${message.parts.body}\n\n${message.parts.quote}`);
    });

    test("4 a Cc goes in cc, in order; no recipient comes from anywhere else", () => {
      const message = buildOutgoingMessage(input({ ...reply, cc: ["b@y.pl", "c@y.pl"] }, {}, mail));
      expect(message.cc).toEqual([
        { name: null, address: "b@y.pl" },
        { name: null, address: "c@y.pl" },
      ]);
    });

    test("5 body_text replaces the body and the signature; subject_text replaces the subject; the quote stays", () => {
      const message = buildOutgoingMessage(
        input({ ...reply, version: 2, body_text: "Moja wersja", subject_text: "Nowy temat" }, {}, mail)
      );
      expect(message.parts.body).toBe("Moja wersja");
      expect(message.subject).toBe("Nowy temat");
      expect(message.parts.quote).toContain("napisał(a):");
    });

    test("6 an original with no text has no quote block", () => {
      const message = buildOutgoingMessage(input(reply, {}, { ...mail, bodyText: "  " }));
      expect(message.parts.quote).toBeNull();
      expect(message.text).toBe(message.parts.body);
    });

    test("8 the text of the body can name no recipient: To and Cc come from the payload only", () => {
      const hostile = { ...reply, body: "Hi\nTo: evil@x.test\nCc: evil2@x.test\nBcc: evil3@x.test\n\nbye" };
      const message = buildOutgoingMessage(input(hostile, {}, { ...mail, bodyText: "Cc: evil4@x.test" }));
      expect(message.to.map((entry) => entry.address)).toEqual(["klient@firma.pl"]);
      expect(message.cc).toEqual([]);
      expect(Object.keys(message.headers)).toEqual(["X-EA-Action-Id"]);
    });

    test("7 the References are the last 20 ids", () => {
      const references = Array.from({ length: 30 }, (_, i) => `<r${i}@x>`);
      const message = buildOutgoingMessage(input(reply, {}, { ...mail, references }));
      expect(message.references).toHaveLength(20);
      expect(message.references.at(-1)).toBe("<a@x>");
      expect(message.references[0]).toBe("<r11@x>");
    });
  });

  describe("the name and the signature of the mailbox (reply drafts)", () => {
    const build = (patch: Partial<BuildInput>) => buildOutgoingMessage(input(delegation, patch));
    const style = { styleText: "Pozdrawiam, Jan", timezone: "Europe/Warsaw" };

    test("the profile name is the From name; no profile or a blank name: the owner name", () => {
      expect(build({ profile: { displayName: "Anna Nowak", signature: null } }).from).toEqual({
        name: "Anna Nowak",
        address: "User@Interia.pl",
      });
      expect(build({ profile: null }).from.name).toBe("Artek");
      expect(build({}).from.name).toBe("Artek");
      expect(build({ profile: { displayName: "  ", signature: null } }).from.name).toBe("Artek");
      expect(build({ profile: { displayName: null, signature: null } }).from.name).toBe("Artek");
    });

    test("signature: the profile, else the organization style text, else the owner name", () => {
      const profile = (signature: string | null) => ({ displayName: null, signature });
      expect(build({ organization: style, profile: profile("Anna") }).parts.body).toEndWith("\n\nAnna");
      expect(build({ organization: style, profile: profile(null) }).parts.body).toEndWith("\n\nPozdrawiam, Jan");
      expect(build({ organization: style, profile: null }).parts.body).toEndWith("\n\nPozdrawiam, Jan");
      expect(build({ organization: style, profile: profile("  ") }).parts.body).toEndWith("\n\nPozdrawiam, Jan");
      expect(build({ profile: profile(null) }).parts.body).toEndWith("\n\nArtek");
    });
  });

  describe("what each kind of draft carries", () => {
    const reminder = {
      kind: "reminder",
      delegate_id: DELEGATE,
      delegate_name: "Jan",
      to: ["jan@firma.pl"],
      task: "Przygotuj ofertę",
      due_date: "",
      language: "pl",
      delegation_id: DELEGATE,
      reminder: 1,
      thread: { in_reply_to: "<sent@interia.pl>", references: ["<orig@firma.pl>", "<sent@interia.pl>"] },
    } satisfies DraftPayload;
    const clarification = {
      kind: "clarification",
      to: ["klient@firma.pl"],
      question: "Jaki termin?",
      language: "en",
    } satisfies DraftPayload;

    test("a draft with no recipient is refused", () => {
      expect(() => buildOutgoingMessage(input({ ...delegation, to: [] as unknown as string[] }))).toThrow(
        /^draft has no recipient$/
      );
    });

    test("a reminder with an empty due date has no due line; with a date it has one", () => {
      expect(buildOutgoingMessage(input(reminder)).parts.body).toBe(
        "Dzień dobry,\n\nprzypominam o zadaniu: Przygotuj ofertę\nProszę o krótką informację o stanie prac.\n\nArtek"
      );
      expect(buildOutgoingMessage(input({ ...reminder, due_date: "2026-11-10" })).parts.body).toBe(
        "Dzień dobry,\n\nprzypominam o zadaniu: Przygotuj ofertę\nTermin minął: 2026-11-10.\nProszę o krótką informację o stanie prac.\n\nArtek"
      );
    });

    test("a delegation or a clarification has an empty Cc", () => {
      expect(buildOutgoingMessage(input(delegation)).cc).toEqual([]);
      expect(buildOutgoingMessage(input(clarification)).cc).toEqual([]);
    });

    test("a delegation and a clarification keep every id of the chain; only a reply or a follow-up cuts it to 20", () => {
      const references = Array.from({ length: 25 }, (_, i) => `<r${i}@x>`);
      for (const draft of [delegation, clarification]) {
        const message = buildOutgoingMessage(input(draft, {}, { references, messageId: "<a@x>" }));
        expect(message.references).toEqual([...references, "<a@x>"]);
      }
    });

    test("the References drop an empty id and a missing message id, and list each id once", () => {
      const message = buildOutgoingMessage(
        input(delegation, {}, { references: ["<a@x>", "", "<a@x>", "<b@y>", "<b@y>"], messageId: null })
      );
      expect(message.references).toEqual(["<a@x>", "<b@y>"]);
      const withId = buildOutgoingMessage(
        input(delegation, {}, { references: ["<a@x>", "", "<b@y>"], messageId: "<a@x>" })
      );
      expect(withId.references).toEqual(["<a@x>", "<b@y>"]);
    });

    test("the name and the signature of a profile lose their outer spaces", () => {
      const message = buildOutgoingMessage(
        input(delegation, { profile: { displayName: "  Anna Nowak ", signature: "\n Anna \n" } })
      );
      expect(message.from.name).toBe("Anna Nowak");
      expect(message.parts.body).toEndWith("jest poniżej.\n\nAnna");
    });
  });
});
