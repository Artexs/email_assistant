import type { MailboxActionType } from "./planners";

// Which `ready` original actions of one mailbox an expire closes. It lives in core so that `config`
// (the settings setters) and `actions` share it without an import between the two modules.
export interface ExpireFilter {
  mailboxId: string;
  emailId?: string;
  types: readonly MailboxActionType[];
  // The category of the newest triage_results row of the mail.
  category?: { is: string } | { not: string };
  // Also close the `awaiting_approval` sends of the mailbox and their drafts: `expireReady` does it.
  sends?: true;
}
