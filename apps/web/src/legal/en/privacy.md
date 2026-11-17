This page says what the mail assistant does with personal data. It describes the setup as it is at the date of the version shown above. Tables with the data we store and the services that receive data follow the text.

## Who is responsible

- The organization that connects its mailboxes is the controller of its mail. It decides which mail the assistant reads and why.
- \<provider name> runs the service for the organization. For the mail, \<provider name> is the processor and acts on the instruction of the organization.
- For the account data of members (sign-in, sessions, consent), \<provider name> is the controller.
- Contact: \<contact>. Address: \<address>.

## What data

The table "What we store" at the end of this page lists each kind of data, about whom it is, why we keep it and for how long.

- **Mail.** The assistant stores the mail of the connected mailboxes: the text, the subject, the addresses and facts from the headers (sender name, Reply-To, Return-Path, authentication results, list data, attachment names and sizes, link hosts). This includes data of people who are not members: the senders and recipients of that mail.
- **Sent mail.** The assistant can read the Sent folder of a mailbox. It never changes that folder. This is off by default. It runs only when the operator turns the feature on for the organization and a member turns on the switch "Track my sent mail" for the mailbox.
- **AI results.** The AI writes a short reason, extracted fields (such as the task or the question of a draft) and summaries for each mail. The system builds each draft from a fixed text and these fields. The system stores all of them.
- **Members.** The system stores the name, the e-mail address, the language, the password (as a hash), the sessions (device, network address and last day of use), the optional second factor, the version of the terms that the member accepted, and the Telegram chat that the member linked.
- **Mailbox secret.** The password or token of a mailbox is stored encrypted.
- **What the system did.** An audit log keeps who decided what and when. It holds ids, codes and numbers, never mail text.
- **Kept technical ids.** After the text of a mail is cleared, its row stays. The row keeps the Message-ID header, the deduplication key, the thread key and a content hash. The mail sync finds mail by these ids, and counts and the audit log keep working.
- **Logs.** Server logs hold ids, counts, codes and times. They hold no mail text, no address and no password.

## Why and on what basis

The assistant uses the data for these purposes. For each purpose the legal basis is not yet confirmed.

- **Triage:** to sort each mail into a category, with a short reason. Legal basis: \<to confirm: legal basis>.
- **Actions:** to move, flag or mark mail as read when the mode and the switches of the mailbox allow it. A new mailbox starts in shadow mode, where the assistant changes nothing. Legal basis: \<to confirm: legal basis>.
- **Drafts:** to write a draft for a task or a question. The system sends a draft only after an owner approves it. Legal basis: \<to confirm: legal basis>.
- **Digests and notices:** to tell a member about urgent mail, problems and drafts that wait. These go to Telegram, only after the member links Telegram and consents to the data that go there. The system records the consent. Legal basis: \<to confirm: legal basis>.
- **Delegation follow-up:** to remind a delegate of a task. A reminder is a draft that needs the same approval. Legal basis: \<to confirm: legal basis>.
- **Security:** to lock an account after failed sign-ins and to keep the audit log. Legal basis: \<to confirm: legal basis>.
- **Measurement:** to compute weekly numbers and the cost of the AI for each mailbox. Legal basis: \<to confirm: legal basis>.

## How long

- A job runs once a day and clears the stored texts of every organization. The table "What we store" shows the period of each kind of data. The rows stay, so counts and the audit log keep working.
- Each night the server makes a backup of the whole database. A backup holds the data as it was at that time, also texts that the job cleared later and data that someone deleted later. Copies on the server are kept 7 days by default. Copies in the off-site storage are kept \<backup retention>.
- The assistant never deletes mail in your mailbox. The drafts and the folders that the assistant made stay in the mailbox.
- Telegram keeps the messages until you delete them in the chat.

## Who receives data

- The table "Sub-processors" at the end of this page lists each outside service that gets data, what it gets, where it works and when it is in use. A second table lists the services that get no personal data.
- **AI model.** This install uses OpenAI. The assistant sends the text, the subject and the sender of a mail, the delegates, and up to three earlier mails of the same thread as context. It does not send mail older than 7 days, unless the operator loads old mail once (a backfill). According to the paid API terms that apply to this service, OpenAI does not train on API data. The assistant asks OpenAI not to store the data (`store: false`). OpenAI keeps abuse logs for up to 30 days. This install uses no EU region of OpenAI. The public data-controls page of OpenAI was last checked on 2026-11-17. An install can use Google Gemini instead. The column "Used when" shows the condition.
- **Telegram.** Telegram gets only what the consent text of the panel names, after the member consents: the sender and subject of mails, the names (or file types) and sizes of attachments, the short reason or summary of the AI, the texts of drafts that wait for approval with the quoted part of the original mail, the names of delegates and the addresses of the mailboxes. If the member turns on open loops, Telegram also gets who the member waits for, a short description of what was asked or promised, the due date, the subject, and follow-up drafts with their recipients. Chats with a bot are not end-to-end encrypted.
- **Transfers outside the EEA.** This install uses no EU region of OpenAI. OpenAI and Telegram can process data outside the European Economic Area. Transfer mechanism: \<to confirm: transfer mechanism>.
- **Backup.** A backup is encrypted with `age` before it leaves the server. The key to decrypt it is not on the server.
- **Mail provider.** When an owner approves a draft, the mail leaves from the mailbox of the owner through the mail provider of that mailbox.

## AI and decisions

- The AI sorts mail, writes short reasons and summaries, and gives the task or the question that goes into a draft.
- The assistant never sends a mail on its own. A send needs an owner to approve the exact text, in Telegram or in the panel. Without approval the send ends after 48 hours.
- The AI cannot choose a recipient. The system takes recipients from the mail and from the delegates that the organization added.
- A new mailbox is in shadow mode: nothing changes in the mailbox. In assist mode, a move happens only for a category that the owner set to run by itself and that passed the quality gate. Mail that the assistant is unsure about moves only when the owner turns on a separate switch for it.
- Each sorting decision has a reason code in the audit log. The member can reverse an automatic move with Undo for 7 days, in Telegram or in the panel.
- The assistant only sorts, flags, moves and drafts. Whether this is a decision with legal effect: \<to confirm: assessment of automated decisions>.

## Your rights

**Members.**

- **Access and export.** Ask \<contact>. The operator makes an encrypted file with the data of the organization. The file holds no password hash, no mailbox secret, no token and no session.
- **Deletion.** The owner can delete the organization in the Account card, when the operator turned this on. Otherwise ask \<contact>, and the operator deletes it. The delete removes the mailboxes, the mail, the results, the rules, the Telegram links, the audit log and the accounts of the members at once. Backups keep the rows until they expire. After a restore, the operator deletes them again.
- **After a delete,** change the password of each mailbox at the mail provider, because the assistant knew it.
- **Correction and objection.** Write to \<contact>.

**People who are not members** (for example a sender of mail).

- Ask the organization whose mailbox received the mail. The organization is the controller.
- On the written instruction of the organization, the operator can find the data of a person. The operator can also erase it: the system deletes the mail of the person, removes the address from the rows that stay, blanks the stored digests that can list the mail, and keeps a tombstone (a hash of the mail's identifier) so that the mail does not come back at the next sync.
- Some things stay. Telegram messages that arrived stay in the chat until the member deletes them. The mailbox keeps its mail. Delegates and sender rules that hold the address are listed for the organization, and the organization changes them.

**Time and complaint.** The answer to a request comes within one month (Article 12(3) GDPR). You can complain to the supervisory authority. In Poland this is UODO.

## Security

- **Mailbox secrets** are encrypted with AES-256-GCM. The key is outside the database. The server decrypts a secret only in memory. It never goes to logs, to the web app or to Telegram. Use an app password when the provider has one: the stored secret opens the whole mailbox.
- **Connections.** The server always checks the certificates of mail servers (TLS).
- **Panel.** The panel is reachable only through Tailscale, by members of the private network. It has no public address.
- **Backups** are encrypted before upload.
- **Sign-in.** Ten failed sign-ins in 15 minutes lock the account for 15 minutes. A new password is checked against known leaks; only 5 characters of its hash leave the server. A member can turn on a second factor (TOTP).
- **Separation.** Each organization sees only its own data. The code filters every query by organization, and for web requests the database adds row-level security as a second barrier.
- **Logs** hold no mail text.

## Changes

The version of this text is at the top of the page. When the text changes, the version changes. After the next sign-in, each member sees a dialog and must accept the new version. The system records the version and the time of the acceptance.
