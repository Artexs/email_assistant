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
- **AI results.** The AI writes a short reason, extracted fields (such as the task or the question of a draft) and summaries for each mail. The system builds a task, question or reminder draft from a fixed text and these fields. When reply drafts are on for a mailbox, the AI also writes the text of a reply to a mail that needs an answer. Code checks that text before anyone sees it. With open loops on, the AI also reads your own sent mail and writes a short ask or promise (at most 80 characters) and a due date for it; the system stores them. When an owner taps the style suggestion, the AI also describes how you write from your own sent mail; the system stores that description only when an owner saves it.
- **Members.** The system stores the name, the e-mail address, the language, the password (as a hash), the sessions (device, network address and last day of use), the optional second factor, the version of the terms that the member accepted, the Telegram chat that the member linked, and the phones or browsers that the member registered for push notices (an encrypted address of the push service with its keys, a device name and the result of the last send).
- **Mailbox secret.** The password or token of a mailbox is stored encrypted.
- **What the system did.** An audit log keeps who decided what and when. It holds ids, codes and numbers, never mail text.
- **Kept technical ids.** After the text of a mail is cleared, its row stays. The row keeps the Message-ID header, the deduplication key, the thread key and a content hash. The mail sync finds mail by these ids, and counts and the audit log keep working.
- **Logs.** Server logs hold ids, counts, codes and times. They hold no mail text, no address and no password.

## Why and on what basis

The assistant uses the data for these purposes. For each purpose the legal basis is not yet confirmed.

- **Triage:** to sort each mail into a category, with a short reason. Legal basis: \<to confirm: legal basis>.
- **Actions:** to move, flag or mark mail as read when the mode and the switches of the mailbox allow it. A new mailbox starts in shadow mode, where the assistant changes nothing in the mailbox, except a report mail that a member asked for. Legal basis: \<to confirm: legal basis>.
- **Drafts:** to write a draft for a task or a question, and a reply draft for a mail that needs an answer, and, on an owner's tap, a suggested writing style from your own sent mail. The system sends a draft only after an owner approves it. Legal basis: \<to confirm: legal basis>.
- **Digests and notices:** to tell a member about urgent mail, problems and drafts that wait. These go to Telegram, only after the member links Telegram and consents to the data that go there. The system records the consent. They can also go to a phone or browser that the member registered for push notices; a push notice holds a kind, a count and an item id, no mail text. With report by mail on (an optional feature, off by default), the system also puts the digest, the weekly report and two trust notices as a mail into the INBOX of a mailbox that the member chose. It logs in to that mailbox and sends no mail. The provider of that mailbox keeps the mail like other mail, each person who reads that mailbox can read it, and the assistant does not delete it. Legal basis: \<to confirm: legal basis>.
- **Open loops:** to find what you asked or promised in your own sent mail and to remind you of it. This runs only with the feature and the switch "Track my sent mail" on. Legal basis: \<to confirm: legal basis>.
- **Newsletters:** to find newsletters and, after an owner taps Unsubscribe, to ask the sender to remove you from the list. This runs only with the newsletters feature on. Legal basis: \<to confirm: legal basis>.
- **Delegation follow-up:** to remind a delegate of a task. A reminder is a draft that needs the same approval. Legal basis: \<to confirm: legal basis>.
- **Security:** to lock an account after failed sign-ins and to keep the audit log. Legal basis: \<to confirm: legal basis>.
- **Measurement:** to compute weekly numbers and the cost of the AI for each mailbox. Legal basis: \<to confirm: legal basis>.

## How long

- A job runs once a day and clears the stored texts of every organization. The table "What we store" shows the period of each kind of data. The rows stay, so counts and the audit log keep working.
- Each night the server makes a backup of the whole database. A backup holds the data as it was at that time, also texts that the job cleared later and data that someone deleted later. Copies on the server are kept 7 days by default. Copies in the off-site storage are kept \<backup retention>.
- The assistant never deletes mail in your mailbox. The drafts and the folders that the assistant made stay in the mailbox.
- Telegram keeps the messages until you delete them in the chat.
- The system tells the push service to drop a message that it has not delivered after 24 hours at most.

## Who receives data

- The table "Sub-processors" at the end of this page lists each outside service that gets data, what it gets, where it works and when it is in use. A second table lists the services that get no personal data.
- **AI model.** This install uses OpenAI. For each mail that it classifies, the assistant sends the text, the subject, the sender, the To and Cc addresses and the date of the mail, whether the sender is on the whitelist or the VIP list or looks automatic, the delegates, and up to three earlier mails of the same thread as context. Each context mail carries its sender, subject, date and up to 500 characters of its body; context mails have no age limit. To write a reply draft, it sends the text of that mail with its quoted history, the subject, the sender and the date, the display name, the signature and the writing style of the mailbox, the one line of instruction that the member typed, if any, and the time zone of the organization. The assistant does not classify a mail older than 7 days, unless the operator loads old mail once (a backfill) or the history check below runs; the context mails can be older. With the trust ladder on (an optional feature, off by default), a history check also classifies up to 500 mails of the last 30 days of the INBOX, and sends each of them as described above: when the feature is turned on, when a mailbox is connected, on request and after a change of the AI model; it stops at a cost of $0.25. The operator of the install can also start a history check by hand, even when the trust ladder is off. According to the paid API terms that apply to this service, OpenAI does not train on API data. The assistant asks OpenAI not to store the data (`store: false`). OpenAI keeps abuse logs for up to 30 days. This install uses no EU region of OpenAI. The public data-controls page of OpenAI was last checked on 2026-11-17. With open loops on (an optional feature, off by default) and the switch "Track my sent mail" on, for each of your own sent mails that it analyses the assistant also sends the subject, the local date, time and weekday of the send, the number of recipients and up to 8,000 characters of the text. No address from the headers goes. The text goes as written: it can hold names, addresses and quoted mail of other people. The assistant analyses only mail of the last 14 days with at most 10 recipients, and not list, automatic or calendar mail or a draft of the system. A call that fails because of the mail, or that times out, is tried at most three times. When the AI service is busy, down or not set up correctly, the call is tried again later, with no fixed limit. The AI answers with a short ask or promise (at most 80 characters) and a due date. With the style suggestion on (an optional feature, off by default), only when an owner taps "Suggest my style from my sent mail", the assistant sends the text of up to 100 of your own sent mails of that mailbox from the last 14 days: at most 1,500 characters of each and 60,000 characters in all. It first tries to cut off the quoted older mail, the forwarded part and the signature of the mailbox. No subject and no address from the headers goes. The text can still hold names, addresses and quoted mail of other people. It needs the switch "Track my sent mail" on, and it skips list, automatic and calendar mail and drafts of the system. Each tap makes at most two calls with the same texts: the second only when the first answer could not be read or failed a check. A call that fails at the AI service is not tried again. The AI answers with a description of how you write (at most 1,000 characters). The assistant does not store it; an owner can edit it and save it as the writing style of the mailbox. An install can use Google Gemini instead. The column "Used when" shows the condition.
- **Telegram.** Telegram has two levels of detail: the member chooses one, and the owner can lock the level "Counts and links only". At the level "Counts and links only" (`minimal`), Telegram gets only how many items wait and a link to the panel: no sender, subject, summary or draft. At the level "Full" (`full`), which the member turns on, Telegram gets only what the consent text of the panel names, after the member consents: the sender and subject of mails, the names (or file types) and sizes of attachments, the short reason or summary of the AI, the texts of drafts that wait for approval with the quoted part of the original mail, reply drafts that the AI writes for the member, the Reply-To addresses of the original mail that a review card shows, the addresses of the other recipients of a mail (To, Cc) when a reply goes to them, the names of delegates and the addresses of the mailboxes. If the member turns on open loops, Telegram also gets who the member waits for, a short description of what was asked or promised, the due date, the subject, and follow-up drafts with their recipients. Chats with a bot are not end-to-end encrypted.
- **Push services.** A phone or browser that a member registered gets notices through the push service of its browser (Google FCM, Mozilla, Apple or Microsoft). The system encrypts each message for the device. The push service gets the encrypted message (version, notice id, kind, count, item id, language), which it cannot read, the push address of the device, the time, size, lifetime (24 hours), urgency and topic (a hash of the notice id) of the message, and the contact of the operator in the signed token of the sender (VAPID). A push notice holds no sender, subject or mail text. The member can remove a device in the panel.
- **Transfers outside the EEA.** This install uses no EU region of OpenAI. OpenAI and Telegram can process data outside the European Economic Area. The server of a newsletter sender can be anywhere. Transfer mechanism: \<to confirm: transfer mechanism>.
- **Newsletter senders.** With the newsletters feature on (optional, off by default), after an owner taps Unsubscribe on a newsletter, the server sends one HTTPS POST to the link that the newsletter wrote in its own mail. The body is fixed (`List-Unsubscribe=One-Click`) and the program name is fixed. The request comes from the network address of the server, with no cookie and no sign-in, and the server sends it once with no repeat. The link can identify you as the subscriber. That server learns that this subscription asks to leave, that the mailbox is in use, when the tap happened and the network address of our server. The request holds no other mailbox data. The system keeps the sender address, the domain and the result, not the link.
- **Backup.** A backup is encrypted with `age` before it leaves the server. The key to decrypt it is not on the server.
- **Mail provider.** When an owner approves a draft, the mail leaves from the mailbox of the owner through the mail provider of that mailbox. With report by mail on, the system puts a report mail into the INBOX of the mailbox that the member chose; the provider of that mailbox keeps it like other mail.

## AI and decisions

- The AI sorts mail, writes short reasons and summaries, and gives the task or the question that goes into a draft. For a mail that needs an answer, it can write the text of a reply draft. With open loops on, it also gives the ask or promise that it finds in your own sent mail. On an owner's tap, it can describe how you write from your own sent mail; nothing is stored until an owner saves it.
- The assistant never sends a mail on its own. A send needs an owner to approve the exact text, in Telegram or in the panel. Without approval the send ends after 48 hours (a reply draft: after 7 days).
- The AI cannot choose a recipient. The system takes recipients from the mail and from the delegates that the organization added.
- A new mailbox is in shadow mode: nothing changes in the mailbox, except a report mail that a member asked for. In assist mode, a move happens only for a category that the owner set to run by itself and that passed the quality gate. Mail that the assistant is unsure about moves only when the owner turns on a separate switch for it.
- Each sorting decision has a reason code in the audit log. The member can reverse an automatic move with Undo for 7 days, in Telegram or in the panel.
- The assistant only sorts, flags, moves and drafts, tracks open loops and, after an owner's tap, asks a newsletter to unsubscribe. Whether this is a decision with legal effect: \<to confirm: assessment of automated decisions>.

## Your rights

**Members.**

- **Access and export.** Ask \<contact>. The operator makes an encrypted file with the data of the organization. The file holds no password hash, no mailbox secret, no token and no session.
- **Deletion.** The owner can delete the organization in the Account card, when the operator turned this on. Otherwise ask \<contact>, and the operator deletes it. The delete removes the mailboxes, the mail, the results, the rules, the Telegram links, the push devices, the audit log and the accounts of the members at once. Backups keep the rows until they expire. After a restore, the operator deletes them again.
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
