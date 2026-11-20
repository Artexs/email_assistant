export const E2E_ORG_NAME = "E2E";
export const E2E_OWNER_EMAIL = "e2e-owner@x.test";
// A test value, not a secret.
export const E2E_OWNER_PASSWORD = "e2e-correct-horse-battery";
export const E2E_PROJECTS = ["mobile", "desktop"] as const;
export type E2eProject = (typeof E2E_PROJECTS)[number];
// The run tag keeps the GreenMail addresses of two runs apart: the GreenMail of the dev stack is shared, and an account is the
// address. Unset: the address stays as it is (the main checkout and CI). A tag is 1 to 16 lowercase letters or digits.
export function mailTagFromEnv(env: Record<string, string | undefined>): string {
  const tag = env.E2E_MAIL_TAG;
  if (tag === undefined || tag === "") return "";
  if (!/^[a-z0-9]{1,16}$/.test(tag)) {
    throw new Error("E2E_MAIL_TAG must be 1 to 16 characters of a-z and 0-9");
  }
  return tag;
}
// Inserts `-<tag>` before the last `@`. An empty tag returns the address unchanged.
export function taggedAddress(address: string, tag: string): string {
  if (tag === "") return address;
  const at = address.lastIndexOf("@");
  return `${address.slice(0, at)}-${tag}${address.slice(at)}`;
}
// The address of a mailbox that a run connects to the GreenMail, with the tag of the run.
export const greenMailAddress = (base: string): string => taggedAddress(base, mailTagFromEnv(process.env));
// The guard of the seed: with a tag set, a GreenMail mailbox without the tag is a bug that would mix the mail of two runs.
export function assertTaggedMailbox(address: string, tag: string): void {
  if (tag === "") return;
  const at = address.lastIndexOf("@");
  if (at < 0 || !address.slice(0, at).endsWith(`-${tag}`)) {
    throw new Error(`a GreenMail mailbox of the seed does not carry E2E_MAIL_TAG (${tag})`);
  }
}
export const E2E_ASSISTANT_EMAILS: Record<E2eProject, string> = {
  mobile: "e2e-assistant-mobile@x.test",
  desktop: "e2e-assistant-desktop@x.test",
};
export const E2E_MEMBER_EMAILS: Record<E2eProject, string> = {
  mobile: "e2e-member-mobile@x.test",
  desktop: "e2e-member-desktop@x.test",
};
// A test value, not a secret.
export const E2E_MEMBER_PASSWORD = "e2e-member-passphrase-one";
export const E2E_TERMS_EMAILS: Record<E2eProject, string> = {
  mobile: "e2e-terms-mobile@x.test",
  desktop: "e2e-terms-desktop@x.test",
};
export const e2eTermsOrgName = (project: E2eProject): string => `E2E Terms ${project}`;
// One owner per project whose second factor the two-factor spec turns on and off.
export const E2E_TWO_FACTOR_EMAILS: Record<E2eProject, string> = {
  mobile: "e2e-two-factor-mobile@x.test",
  desktop: "e2e-two-factor-desktop@x.test",
};
export const e2eTwoFactorOrgName = (project: E2eProject): string => `E2E Two-factor ${project}`;
// One organization per project that only the delete spec uses (it deletes the organization). The owner
// and an assistant share the member password. The mailbox address names the width, as the spec asserts it on the login page.
export const E2E_DELETE_OWNER_EMAILS: Record<E2eProject, string> = {
  mobile: "e2e-delete-owner-mobile@x.test",
  desktop: "e2e-delete-owner-desktop@x.test",
};
export const E2E_DELETE_ASSISTANT_EMAILS: Record<E2eProject, string> = {
  mobile: "e2e-delete-assistant-mobile@x.test",
  desktop: "e2e-delete-assistant-desktop@x.test",
};
export const e2eDeleteOrgName = (project: E2eProject): string =>
  project === "mobile" ? "E2E Delete Phone" : "E2E Delete Desktop";
export const e2eDeleteMailbox = (project: E2eProject): string =>
  project === "mobile" ? "del-phone@x.test" : "del-desktop@x.test";
export const E2E_OTHER_ORG_NAME = "E2E Other";
export const E2E_OTHER_OWNER_EMAIL = "e2e-other-owner@x.test";
export const E2E_TRIAL_ORG_NAME = "E2E Trial";
export const E2E_TRIAL_OWNER_EMAIL = "e2e-trial-owner@x.test";
export const E2E_PAUSED_ORG_NAME = "E2E Paused";
export const E2E_PAUSED_OWNER_EMAIL = "e2e-paused-owner@x.test";
// An organization with the flag `stats_page` on, for the Stats page. The main organization stays without the flag
// (auth.spec counts its 4 phone tabs). The page reads only; no spec changes this organization.
export const E2E_STATS_ORG_NAME = "E2E Stats";
export const E2E_STATS_OWNER_EMAIL = "e2e-stats-owner@x.test";
