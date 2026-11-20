import { describe, expect, test } from "bun:test";

import { encodeNoticeView } from "./encode";
import { renderNotice } from "./render";
import type { NoticeView } from "./views";

const id1 = "11111111-1111-4111-8111-111111111111";
const id2 = "22222222-2222-4222-8222-222222222222";
const full = { channel: "telegram", detail: "full", locale: "en" } as const;

const bare: NoticeView<"urgent"> = {
  emailId: id1,
  from: "boss@example.test",
  subject: "Contract",
  ai: { reasonCode: "llm", reason: "Deadline today" },
  receivedAt: new Date("2026-11-12T22:15:00.000Z"),
  synthetic: false,
  folderTag: null,
  actions: [
    { type: "create_draft", status: "ready", folder: null, reverse: false, kind: "delegation", delegateId: id2 },
    { type: "move", status: "logged", folder: "ai_info", reverse: false, kind: null, delegateId: null },
  ],
  delegateNames: { [id2]: "Anna Nowak" },
  stayFolder: "INBOX",
  now: new Date("2026-11-13T10:07:33.123Z"),
  timeZone: "Europe/Warsaw",
};
const loaded: NoticeView<"urgent"> = {
  ...bare,
  folderTag: "Oferty",
  synthetic: true,
  suspicious: ["link_mismatch"],
  attachments: {
    attachments: [{ name: "faktura.pdf", type: "application/pdf", size: 122880, inline: false }],
    count: 1,
  },
  confidence: 0.9,
  rule: "vip",
  delegable: true,
  draftable: true,
};

describe("the urgent notice on Telegram, full detail", () => {
  test("a view with every optional field renders each line and both extra buttons", () => {
    expect(renderNotice("urgent", encodeNoticeView("urgent", loaded), full)).toEqual({
      ok: true,
      message: {
        text: [
          "🔴 Urgent mail · 📁 Oferty · 🧪 test",
          "From: boss@example.test",
          "Subject: Contract",
          "📎 1: faktura.pdf (120 kB)",
          "💬 Deadline today · rule: VIP sender",
          "⚠ Suspicious: link goes elsewhere",
          "Received 12 Nov 23:15",
          "→ will draft a delegation to Anna Nowak; would move to AI/Info",
        ].join("\n"),
        buttons: [
          [
            { text: "✅ Right", data: `fr:u:${id1}` },
            { text: "✏️ Change", data: `fe:${id1}` },
            { text: "👥 Delegate", data: `dg:${id1}` },
          ],
          [{ text: "✍️ Draft reply", data: `dr:${id1}` }],
        ],
      },
    });
  });
});

describe("the urgent notice on Telegram, the stay folder", () => {
  test("a view with no action to show names the folder the mail stays in", () => {
    const result = renderNotice(
      "urgent",
      encodeNoticeView("urgent", { ...bare, actions: [], stayFolder: "Oferty" }),
      full
    );
    expect(result.ok && result.message.text.split("\n").at(-1)).toBe("→ stays in Oferty");
  });
});
