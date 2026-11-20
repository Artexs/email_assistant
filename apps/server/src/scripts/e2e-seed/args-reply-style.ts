import { greenMailAddress, type E2eProject } from "./args-core";

// One organization per project for the style card spec (it saves a name, a signature and a writing style, and turns the
// reply drafts switch on, so each project needs its own). The flags `reply_drafts`, `style_from_sent` and `sent_sync` are on.
// Two mailboxes in assist mode: `box` signs in with a password, `oauth` has a provider set (the switch is disabled for it).
export const E2E_REPLY_STYLE_OWNER_EMAILS: Record<E2eProject, string> = {
  mobile: "e2e-reply-style-owner-mobile@x.test",
  desktop: "e2e-reply-style-owner-desktop@x.test",
};
export const E2E_REPLY_STYLE_MEMBER_EMAILS: Record<E2eProject, string> = {
  mobile: "e2e-reply-style-member-mobile@x.test",
  desktop: "e2e-reply-style-member-desktop@x.test",
};
export const e2eReplyStyleOrgName = (project: E2eProject): string => `E2E Reply Style ${project}`;
export const e2eReplyStyleMailbox = (project: E2eProject, which: "box" | "oauth"): string =>
  greenMailAddress(`e2e-reply-style-${which}-${project}@e2e.test`);
