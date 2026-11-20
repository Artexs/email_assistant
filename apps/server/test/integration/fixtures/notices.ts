import { randomUUID } from "node:crypto";

import {
  encodeNoticeView,
  noticeChannels,
  noticeDetails,
  noticeKindSchema,
  outButtonsSchema,
  renderNotice,
  userLocaleSchema,
  type OutMessage,
} from "@ea/core";
import { z } from "zod";

import type { SuspiciousContext } from "../../../src/modules/triage";

// The message a row stands for: its sent text, or the render of its view (as the sender makes it).
export function renderedOf(row: {
  kind: string;
  view: unknown;
  channel: string;
  detail: string;
  locale: string;
  text: string | null;
  buttons: unknown;
}): OutMessage {
  if (row.text !== null) return { text: row.text, buttons: outButtonsSchema.parse(row.buttons) };
  const rendered = renderNotice(noticeKindSchema.parse(row.kind), row.view, {
    channel: z.enum(noticeChannels).parse(row.channel),
    detail: z.enum(noticeDetails).parse(row.detail),
    locale: userLocaleSchema.parse(row.locale),
  });
  if (!rendered.ok) throw new Error("view does not render");
  return rendered.message;
}
// A valid view of the kind whose rendered text holds the marker; for rows that only need a text to read or send.
export function testNoticeView(
  kind: "urgent" | "digest" | "approval" | "approval_set",
  input: { marker: string; emailId?: string; at: Date }
): Record<string, unknown> {
  const timeZone = "Europe/Warsaw";
  switch (kind) {
    case "urgent":
      if (input.emailId === undefined) throw new Error("urgent view needs an email id");
      return encodeNoticeView("urgent", {
        emailId: input.emailId,
        from: "sender@example.test",
        subject: input.marker,
        ai: { reasonCode: "llm", reason: null },
        receivedAt: input.at,
        synthetic: false,
        folderTag: null,
        actions: [],
        delegateNames: {},
        stayFolder: "INBOX",
        now: input.at,
        timeZone,
      });
    case "digest":
      return encodeNoticeView("digest", { text: input.marker, buttons: [[{ text: "OK", data: "ok" }]] });
    case "approval":
      return encodeNoticeView("approval", {
        actionId: randomUUID(),
        view: {
          kind: "delegation",
          recipient: { name: null, address: "delegate@example.test" },
          sender: null,
          recipientInactive: false,
          subject: input.marker,
          dueDate: null,
          body: "Body",
          quote: null,
          synthetic: false,
        },
        now: input.at,
        timeZone,
      });
    case "approval_set":
      return encodeNoticeView("approval_set", {
        setId: randomUUID(),
        items: [
          {
            n: 1,
            delegateName: "Anna",
            address: "delegate@example.test",
            subject: input.marker,
            dueAt: null,
            reminder: 1,
            task: "Task",
          },
        ],
        timeZone,
      });
  }
}
// A suspicious context with no known sender, no known domain and no trusted header: no rule can fire. For tests that do not read reasons.
export const noSuspiciousContext: SuspiciousContext = {
  isKnown: () => false,
  knownDomains: [],
  sentDomains: [],
  protectedNames: [],
  trustedAuthservIds: [],
};
