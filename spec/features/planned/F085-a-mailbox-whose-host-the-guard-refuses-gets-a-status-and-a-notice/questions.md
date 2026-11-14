# F085 questions (defaults taken; owner to confirm)

The ticket sets the outcome (a status, one notice per episode, no host name or address, a fake-resolver test). These are the smaller choices the plan had to make. None blocks the build; each names the decision in `plan.md` that holds it and how to change it.

## Q1 [important: user-visible] The status is a new mailbox status `host_blocked`, and it stops the mailbox

- Default: `mailboxes.status` gets a fourth value `host_blocked`. Like `auth_error`, the system then does not read, triage, act on or send from the mailbox until the status ends. D1.
- Why: the ticket asks for a status; `auth_error` is the existing shape (status, episode, notice, way out); a refused host means the system must not connect at all.
- Other option: keep `active` and add a column `host_blocked_at`; the sync keeps trying every run. Change: a different stage 02 migration and readers; the plan would need a new review.

## Q2 [important: user-visible] The mailbox comes back by itself, with no "works again" notice

- Default: at the start of each sync run the system checks both server names of a blocked mailbox with the guard (no connection, no password). When both pass, the mailbox is `active` again and syncs in the same run. A successful password change also ends the status. The owner gets no message when it ends; `/status`, the digest and the panel show it. D5.
- Why: the owner cannot change a server name in the product (there is no host edit), so the way out must not need the owner.
- Other option: a "mail server allowed again" notice (one more notice kind). Change: a new kind and detector, as stage 02 does for `host_blocked`.

## Q3 [important: privacy] The notice names the mailbox by its own mail address

- Default: the text names the mailbox by its mail address (as the login-error notice does) and never prints the server name, the resolved network address, the port or which server (IMAP or SMTP) was refused. No log line, audit row, CLI line or panel text prints them either. D8, D9.
- Why: "no host name or address in the text" (ticket) keeps internal network facts out of chat; the mail address is needed to tell two mailboxes apart.
- Other option: no mail address either (the owner cannot tell which mailbox with two or more). Change: the view and the first text line (stages 01 and 02).

## Q4 [important: rule-exception] No feature flag

- Default: the status and the notice ship without a flag, although the styleguide puts each new user-visible behaviour behind one. D15.
- Why: it fixes an error path that exists today (a refused host fails every sync run silently); `auth_error` and `send_held` notices ship without a flag; a flag would keep the silent failure for every organization without it.
- Other option: a flag `host_blocked_status` (default off). Change: every writer of stage 05 reads the flag first.

## Q5 [minor] A refused SMTP server blocks reading too

- Default: one status for both servers; a refused SMTP host (found at send time) stops the sync as well. D4.
- Other option: a send-only hold. Change: a second state that every send reader must know.

## Q6 [minor] No panel banner

- Default: the mailbox card shows the badge "Server not allowed" and a hint; the operator list counts it. The top banner stays for login errors only. D13.
- Other option: extend the banner to blocked mailboxes. Change: `/api/me` count, `AuthErrorBanner`, two texts.

## Q7 [minor] No operator notice

- Default: the operator sees the count in the console and in `org:status`; no Telegram notice to the operator (unlike `auth_error_24h`). D21.

## Q8 [minor] The audit rows are not in the owner's security log

- Default: `mailbox.host_blocked` and `mailbox.host_allowed` are audit rows, not `securityEvents`. D20.

## Q9 [minor] No flap guard

- Default: each new episode (the server name passes, then is refused again) gives a new notice. A public provider never resolves into the refused ranges, so a flap is a DNS problem worth a message. D6.

## Q10 [minor] Pause and resume of a blocked mailbox are refused

- Default: as for `auth_error`: web `409 wrong_status`, Telegram skips it with a hint; removal works. D11.

## Q11 [minor] The exact texts

- Default: the English and Polish strings of D9. The owner may reword them at any time; a change touches only `packages/core/src/texts/` and `apps/web/src/i18n/`.
