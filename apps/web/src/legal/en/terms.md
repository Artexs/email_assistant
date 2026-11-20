These terms say how the service works and what you can expect from it. They describe the setup as it is at the date of the version shown above.

## The service

- The service is a mail assistant. It reads the mail of the mailboxes that the organization connects. It sorts each mail into a category and writes a short reason. It summarizes mail and threads, helps to delegate tasks, filters spam, and writes drafts of replies and reminders.
- A draft goes out only after an owner of the organization approves it.
- The service runs on a private server for its owner only. \<provider name> runs it. Contact: \<contact>. Address: \<address>.
- The privacy policy and the data processing agreement are separate pages. You find the links to both on the sign-in page and in the Account card.

## Accounts

- There is no sign-up. The operator (the person who runs the server) creates an organization and its first owner. A member is an owner or an assistant.
- A new member opens a setup link. The link works once. The member accepts the terms and sets a password of 12 to 128 characters. The system checks a new password against known leaks.
- Ten failed sign-ins in 15 minutes lock the account for 15 minutes.
- A member can turn on a second factor (TOTP). If the operator set up company sign-in for the organization, members can sign in with their company account.
- A session lasts up to 30 days. A member can end all sessions, or all other sessions, in the Account card.

## Plan state

- Each organization has one plan state: `trial`, `active` or `suspended`. The operator changes it. A trial that ends does not change the state by itself.
- An organization has a limit on the number of mailboxes. The operator sets the limit.
- While an organization is `suspended`, the assistant is paused for it. It does not read new mail, sort mail or send digests. Telegram commands, except help, only answer that the account is paused. After the resume, mail that arrived more than 24 hours before the resume is not sorted.
- A member of a suspended organization can still read the panel and accept the terms. A member can also choose the language, and the owner can delete the organization.
- These terms set no price and no payment terms.

## Your mailbox

- The service stores the password of a mailbox encrypted. Use an app password when the mail provider has one. The stored secret opens the whole mailbox.
- A new mailbox is in shadow mode. In shadow mode the assistant changes nothing in the mailbox and only reports what it would do. The one exception is a report mail that a member asked for.
- In assist mode, the assistant can move mail, flag it, mark it as read and save drafts in the Drafts folder of the mailbox. A move or a mark as read happens only for a category that the owner set to run by itself and that passed the quality gate. Mail that the assistant is unsure about moves only when the owner turns on a separate switch for it.
- The assistant never sends a mail without an owner. The owner taps Send on the exact text, in Telegram or in the panel. Without a tap the send ends after 48 hours (a reply draft: after 7 days).
- The assistant never deletes mail in your mailbox.
- When the organization is deleted, the drafts and folders that the assistant made stay in the mailbox. The owner removes them.

## AI output

- The AI can be wrong. It can sort a mail into the wrong category, write a wrong summary or write a draft that does not fit.
- The owner reads each draft before the owner approves it. The assistant never sends a draft on its own.
- Each automatic change of a mail can be reversed with Undo for 7 days, in Telegram or in the panel. The feedback buttons tell the service that a result was wrong.

## Availability

- The service has no service level. No promise of uptime or response time applies.
- The server makes one backup of the database each night.
- The panel is reachable only on the private network of the owner (Tailscale). It has no public address.

## End and deletion

- The owner can delete the organization in the Account card, when the operator turned this on. Otherwise ask \<contact>, and the operator deletes it. The delete removes the mailboxes, the mail, the results, the rules, the Telegram links, the push devices, the audit log and the accounts of the members at once.
- Backups keep the rows until they expire. After a restore of a backup, the operator deletes the organization again.
- After a delete, change the password of each mailbox at the mail provider, because the assistant knew it.
- On request the operator makes an encrypted export of the data of the organization. The export holds no password hash, no mailbox secret, no token and no session.

## Liability and law

- Liability: \<to confirm: liability>.
- Governing law and court: \<to confirm: governing law>.

## Changes

The version of these terms is at the top of the page. When the text changes, the version changes. After the next sign-in, each member sees a dialog and must accept the new version. The system records the version and the time of the acceptance.
