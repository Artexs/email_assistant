import { greenMailAddress, type E2eProject } from "./args-core";

// One organization per project for the newsletters spec. The flag `bulk_unsubscribe` is on; one mailbox with five
// newsletter senders (see `e2e-newsletter-rows.ts`). The addresses are the identity of the rows. The server of the e2e run trusts the
// authserv-id `E2E_AUTHSERV_ID` (`MAIL_TRUSTED_AUTHSERV_IDS`), so a `dkim=pass` of that id gives one-click.
export const E2E_AUTHSERV_ID = "mx.e2e.test";
export const E2E_NEWSLETTERS_OWNER_EMAILS: Record<E2eProject, string> = {
  mobile: "e2e-newsletters-owner-mobile@x.test",
  desktop: "e2e-newsletters-owner-desktop@x.test",
};
export const E2E_NEWSLETTERS_MEMBER_EMAILS: Record<E2eProject, string> = {
  mobile: "e2e-newsletters-member-mobile@x.test",
  desktop: "e2e-newsletters-member-desktop@x.test",
};
export const e2eNewslettersOrgName = (project: E2eProject): string => `E2E Newsletters ${project}`;
export const e2eNewslettersMailbox = (project: E2eProject): string =>
  greenMailAddress(`e2e-newsletters-${project}@e2e.test`);
// `name` is the display name of the newest mail: text of the sender, shown small. The `markup` sender has hostile text in it.
export const E2E_NEWSLETTER_SENDERS = {
  oneClick: { address: "one-click@news.example", name: "One Click Weekly", count: 3 },
  link: { address: "link@news.example", name: "Link Letter", count: 2 },
  none: { address: "plain@news.example", name: "Plain Notes", count: 1 },
  failed: { address: "failed@news.example", name: "Failed Daily", count: 1 },
  markup: { address: "markup@news.example", name: "<img src=x onerror=alert(1)>", count: 1 },
} as const;
export const E2E_NEWSLETTER_LINK = "https://unsub.news.example/u?id=42";
