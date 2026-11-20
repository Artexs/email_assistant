This agreement covers the mail that the organization gives to the service. It follows the points of Article 28(3) GDPR. The organization is the controller. \<provider name> is the processor. The page describes the setup as it is at the date of the version shown above.

## Parties and subject

- **Controller:** \<organization name>, the organization that connects its mailboxes to the service.
- **Processor:** \<provider name>. Address: \<address>. Contact: \<contact>.
- **Subject:** the processor processes the mail of the connected mailboxes for the service, on behalf of the controller.
- **Duration:** the life of the organization in the service. It ends with the end described in section 10.

## Nature and purpose

The processor processes the mail only to run these functions for the controller:

- **Triage:** to sort each mail into a category, with a short reason.
- **Actions:** to move, flag or mark mail as read, as the mode and the switches of each mailbox allow.
- **Drafts:** to write drafts of replies and questions. A draft is sent only after an owner approves it.
- **Digests:** to tell the members about urgent mail, problems and drafts that wait, in Telegram or by push notice to a registered phone or browser. With report by mail on, also by a mail that the processor puts into the INBOX of a mailbox that the member chose.
- **Open loops:** to find what a member asked or promised in the own sent mail of the mailbox, and to remind the member of it. This runs only with the feature on.
- **Newsletters:** to find newsletters and, after an owner taps Unsubscribe, to send one request to the link that the newsletter wrote, so that the sender removes the mailbox from the list. This runs only with the feature on.
- **Delegation follow-up:** to remind a delegate of a task, with a draft that needs the same approval.

## Data and data subjects

- The kinds of data are in the table "What we store" of the [privacy policy](/legal/en/privacy). The table shows the purpose and the storage period of each kind.
- The data subjects are the members of the organization and the people who send or receive the mail of the connected mailboxes.

## Instructions

- The processor acts only on the documented instructions of the controller.
- The instructions are the settings that the controller makes in the panel (mailboxes, modes, switches, categories, rules and delegates) and the written requests of the owner of the organization, for example a request to export, to delete or to find or erase the data of one person.

## Confidentiality

- The processor gives access to the data of the controller only to the operator, the person who runs the server. Members of the organization see only the data of their own organization.
- Staff: \<to confirm: staff>.

## Security measures

Annex 1. The processor applies these measures:

- Mailbox secrets are encrypted with AES-256-GCM. The key is outside the database. The server decrypts a secret only in memory. It never goes to logs, to the web app or to Telegram.
- The server always checks the certificates of mail servers (TLS).
- The panel is reachable only through Tailscale, by members of the private network. It has no public address.
- Backups are encrypted with `age` before upload. The key to decrypt them is not on the server.
- Ten failed sign-ins in 15 minutes lock the account for 15 minutes. A new password is checked against known leaks; only 5 characters of its hash leave the server. A member can turn on a second factor (TOTP).
- Each organization sees only its own data. The code filters every query by organization, and for web requests the database adds row-level security as a second barrier.
- Logs hold ids, counts, codes and times. They hold no mail text, no address and no password.

## Sub-processors

- The controller gives the processor a general written authorisation to use the sub-processors of Annex 2. Annex 2 is the table at the end of this page. It lists each service, what data it gets, where it works and when it is in use.
- When Annex 2 gets a new row, the version of this text changes. Each member then sees the dialog at the next sign-in.
- Period to object to a new sub-processor: \<to confirm: objection period>.
- Obligations of each sub-processor (Article 28(4) GDPR): \<to confirm: sub-processor contracts>.

## Help with requests

- The processor tells the controller about a request that it receives from a data subject. The processor does not answer the request itself, unless the controller authorises it.
- On the written instruction of the owner of the organization, the processor finds the data of one person and erases it. The processor tells the controller which data it found, so that the controller can answer.
- The controller answers a request within one month (Article 12(3) GDPR).
- Help with the duties of the controller for security, breach notices and impact assessments (Articles 32 to 36 GDPR): \<to confirm: help with Articles 32 to 36>.

## Breaches

- The processor tells the controller without undue delay after it becomes aware of a personal data breach.
- The processor follows its own breach procedure.

## End

- When the organization is deleted, the delete removes its data at once: the mailboxes, the mail, the results, the rules, the Telegram links, the push devices, the audit log and the accounts of the members.
- On request, the processor makes an encrypted export of the data first.
- Backups keep the rows until they expire. Copies on the server are kept 7 days by default. Copies in the off-site storage are kept \<backup retention>.
- The mailbox of the controller keeps its mail. The drafts and the folders that the assistant made stay in it.

## Audits

- Audit rights of the controller: \<to confirm: audit rights>.
- Information that shows compliance with Article 28 GDPR: \<to confirm: proof of compliance>.
