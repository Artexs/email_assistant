import { publicContentProblems, renderNotice, type OutMessage } from "@ea/core";

// The Telegram notice of step 5 (`urgent`). The e2e servers run with the triage model off, so no mail is triaged as urgent and no notice
// is queued (`README.md`, the spike table). The recording renders the notice with the product renderer from a made-up view and posts it to
// the fake Telegram, so the text and the buttons are the ones a real urgent notice has. A made-up view: no address, no host, no person.
// The view as the outbox stores it: dates are ISO strings (the renderer parses them).
export const URGENT_VIEW = {
  emailId: "00000000-0000-4000-8000-000000000005",
  from: "Contract Desk",
  subject: "Signature needed today",
  ai: { reasonCode: "deadline_today", reason: "The sender asks for a signature before the end of the day." },
  receivedAt: "2026-11-05T09:12:00.000Z",
  synthetic: false,
  folderTag: null,
  actions: [],
  delegateNames: {},
  stayFolder: "INBOX",
  now: "2026-11-05T09:13:00.000Z",
  timeZone: "Europe/Warsaw",
};

// The rendered message, or an error code. A text that breaks a public-content rule is an error: the video is public.
export function urgentNotice(locale: "en" | "pl" = "en"): OutMessage {
  const rendered = renderNotice("urgent", URGENT_VIEW, { channel: "telegram", detail: "full", locale });
  if (!rendered.ok) throw new Error("demo_notice_render");
  const [problem] = publicContentProblems(rendered.message.text, []);
  if (problem !== undefined) throw new Error(`demo_notice_public_content ${problem.rule}`);
  return rendered.message;
}

// The `sendMessage` body of the Bot API for the message: the buttons become an inline keyboard of callback buttons.
export function botBody(chatId: number, message: OutMessage): Record<string, unknown> {
  return {
    chat_id: chatId,
    text: message.text,
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: message.buttons.map((row) =>
        row.map((button) => ({ text: button.text, callback_data: button.data }))
      ),
    },
  };
}
