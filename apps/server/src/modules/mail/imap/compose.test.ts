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
    organization: { styleText: null, timezone: "Europe/Warsaw" },
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
});
