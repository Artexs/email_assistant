import { greenMailAddress, type E2eProject } from "./args-core";

// One organization per project for the reply panel spec (the reply kind on the approvals page and the Draft reply button of the activity
// rows). The flags `approvals_page` and `reply_drafts` are on and so is the reply switch of the mailbox; the model is off in the e2e
// server, so the spec fakes the answers of the two routes that need a drafter (see `e2e-reply-panel-rows.ts`). The mails and their drafts:
// `gap` waits with a gap, `plain` and `plainTwo` are clean drafts (`plainTwo` is version 2 of a redraft with the line "tak na wtorek"),
// `all` has other recipients and two Reply-To addresses (the second has a Cyrillic letter in its domain), `viaReplyTo` has one Reply-To;
// `clean` and `flagged` have no draft (the second looks suspicious).
export const E2E_REPLY_PANEL_OWNER_EMAILS: Record<E2eProject, string> = {
  mobile: "e2e-reply-panel-owner-mobile@x.test",
  desktop: "e2e-reply-panel-owner-desktop@x.test",
};
export const E2E_REPLY_PANEL_MEMBER_EMAILS: Record<E2eProject, string> = {
  mobile: "e2e-reply-panel-member-mobile@x.test",
  desktop: "e2e-reply-panel-member-desktop@x.test",
};
export const e2eReplyPanelOrgName = (project: E2eProject): string => `E2E Reply Panel ${project}`;
export const e2eReplyPanelMailbox = (project: E2eProject): string =>
  greenMailAddress(`e2e-reply-panel-${project}@e2e.test`);
export const E2E_REPLY_PANEL = {
  gap: {
    from: "anna@client.test",
    subject: "E2E reply gap",
    body: "Dzień dobry,\n\nCena to [[kwota]] zł.\n\nPozdrawiam",
    label: "kwota",
    filled: "Dzień dobry,\n\nCena to 120 zł.\n\nPozdrawiam",
  },
  plain: {
    from: "boss@client.test",
    subject: "E2E reply plain",
    body: "Dzień dobry,\n\nTak, wtorek mi pasuje.\n\nPozdrawiam",
  },
  plainTwo: {
    from: "boss2@client.test",
    subject: "E2E reply plain two",
    body: "Dzień dobry,\n\nTak, we wtorek o dziesiątej mi pasuje.\n\nPozdrawiam",
    instruction: "tak na wtorek",
  },
  all: {
    from: "anna2@client.test",
    subject: "E2E reply all",
    body: "Dzień dobry,\n\nDziękuję za wiadomość.\n\nPozdrawiam",
    to: ["b@y.test"],
    cc: ["c@z.test"],
    replyTo: ["office@client.test", "info@cl\u0456ent.test"],
  },
  viaReplyTo: {
    from: "carla@client.test",
    subject: "E2E reply via reply-to",
    body: "Dzień dobry,\n\nSprawdzę to jutro.\n\nPozdrawiam",
    replyTo: ["billing@client.test"],
  },
  clean: { from: "dan@client.test", subject: "E2E reply clean" },
  flagged: { from: "erin@client.test", subject: "E2E reply flagged" },
} as const;
