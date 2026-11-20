import { buildOutgoingMessage, type BuildInput, type DraftPayload } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { composeMessage } from "./compose";

const ID = "11111111-1111-4111-8111-111111111111";

const delegation = {
  kind: "delegation",
  delegate_id: "22222222-2222-4222-8222-222222222222",
  delegate_name: "Jan Kowalski",
  to: ["jan@firma.pl"],
  task: "Przygotuj ofertę",
  due_date: "2026-11-10",
  language: "pl",
} satisfies DraftPayload;

const clarification = {
  kind: "clarification",
  to: ["klient@firma.pl"],
  question: "Kto?",
  language: "pl",
} satisfies DraftPayload;

function input(draft: DraftPayload = delegation): BuildInput {
  return {
    draft,
    draftActionId: ID,
    createdAt: new Date("2026-11-07T08:00:00Z"),
    mailbox: { address: "user@interia.pl" },
    owner: { displayName: "Artek" },
    organization: { timezone: "Europe/Warsaw" },
    original: {
      fromAddress: "klient@firma.pl",
      subject: "Zażółć gęślą jaźń",
      receivedAt: new Date("2026-11-06T09:00:00Z"),
      messageId: "<orig@firma.pl>",
      inReplyTo: "<prev@firma.pl>",
      references: ["<root@firma.pl>", "<prev@firma.pl>"],
      bodyText: "Proszę o ofertę.",
    },
  };
}

describe("composeMessage", () => {
  test("writes the identity headers, QP body and CRLF line ends", async () => {
    const message = buildOutgoingMessage(input(clarification));
    const text = (await composeMessage(message)).toString("latin1");
    expect(text).toContain(`Message-ID: <ea-${ID}@interia.pl>`);
    expect(text).toContain("Date: Sat, 07 Nov 2026 08:00:00 +0000");
    expect(text).toContain("In-Reply-To: <orig@firma.pl>");
    expect(text).toContain("References:");
    expect(text).toMatch(new RegExp(`^x-ea-action-id: ${ID}$`, "im"));
    expect(text).toContain("MIME-Version: 1.0");
    expect(text).toContain("Content-Transfer-Encoding: quoted-printable");
    expect(text.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  });

  test("two builds are byte-equal", async () => {
    const message = buildOutgoingMessage(input());
    const first = await composeMessage(message);
    const second = await composeMessage(message);
    expect(first.equals(second)).toBe(true);
  });

  test("encodes a Polish subject and body", async () => {
    const text = (await composeMessage(buildOutgoingMessage(input()))).toString("latin1");
    expect(text).toMatch(/^Subject: =\?UTF-8\?[QB]\?/m);
    expect(text).not.toContain("Zażółć");
    expect(text).toContain("=C4=85");
  });

  test("writes the display name of a recipient", async () => {
    const text = (await composeMessage(buildOutgoingMessage(input()))).toString("latin1");
    expect(text).toContain("To: Jan Kowalski <jan@firma.pl>");
  });

  test("a follow-up writes every To and Cc address and the thread headers", async () => {
    const followUp = {
      kind: "follow_up",
      loop_id: "33333333-3333-4333-8333-333333333333",
      to: ["anna@example.test", "ewa@example.test"],
      cc: ["jan@example.test"],
      language: "en",
      sent_at: "2026-11-10T09:30:00.000Z",
      subject: "Offer",
      quote: "Can you confirm?",
      n: 1,
    } satisfies DraftPayload;
    const text = (await composeMessage(buildOutgoingMessage(input(followUp)))).toString("latin1");
    expect(text).toContain("To: anna@example.test, ewa@example.test");
    expect(text).toContain("Cc: jan@example.test");
    expect(text).toContain("Subject: Re: Offer");
    expect(text).toContain("In-Reply-To: <orig@firma.pl>");
  });

  test("a reply writes To, Cc and the thread headers, adds no marker and no header of ours but the action id", async () => {
    const reply = {
      kind: "reply",
      to: ["klient@firma.pl"],
      cc: ["b@y.pl"],
      language: "pl",
      body: "Dzień dobry,\n\nsprawdzę i wrócę z odpowiedzią.",
      request_id: "44444444-4444-4444-8444-444444444444",
      folder: "INBOX",
      recipients: "all",
    } satisfies DraftPayload;
    const raw = (await composeMessage(buildOutgoingMessage(input(reply)))).toString("latin1");
    const head = raw.slice(0, raw.indexOf("\r\n\r\n"));
    expect(head).toContain("To: klient@firma.pl");
    expect(head).toContain("Cc: b@y.pl");
    expect(head).toContain("In-Reply-To: <orig@firma.pl>");
    expect(head).toContain("References: <root@firma.pl> <prev@firma.pl> <orig@firma.pl>");
    // Only the headers of the standard set and the one header that finds our own draft.
    const custom = head.split("\r\n").filter((line) => /^x-/i.test(line));
    expect(custom).toEqual([`X-Ea-Action-ID: ${ID}`]);
    expect(raw).not.toContain("[[");
  });

  test("a reply body with header-like lines adds no header and no recipient", async () => {
    const reply = {
      kind: "reply",
      to: ["klient@firma.pl"],
      cc: [],
      language: "en",
      body: "Hi\r\nBcc: evil@x.test\r\nTo: evil2@x.test\r\n\r\nbye",
      request_id: "44444444-4444-4444-8444-444444444444",
      folder: "INBOX",
      recipients: "from",
    } satisfies DraftPayload;
    const raw = (await composeMessage(buildOutgoingMessage(input(reply)))).toString("latin1");
    const head = raw.slice(0, raw.indexOf("\r\n\r\n"));
    expect(head).not.toMatch(/^bcc:/im);
    expect(head.match(/^to:/gim)).toHaveLength(1);
    expect(head).not.toContain("evil");
  });
});
