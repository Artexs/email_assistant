# F116 stage 10 review (Opus 5.5, PASS 7db20aa0)

Model: Opus 5.5, because the stage is [risky]: the committer path sends mail to real people.

No BLOCKING. A real committer tick sends only the approved send with a stale lock, once; awaiting, rejected, expired and out-of-TTL sends get no `send_started_at`; every production `actions` insert sets `email_id` (only `insertReverse` copies a `loop_id`), so no production path creates a loop send yet; a follow-up payload on a mail is `bad_payload`. CRLF in subject, `message_id` or `references_ids` does not inject a header; a `bcc` key is stripped; a display name, more than 10 recipients or a Cc outside the draft and loop is `bad_payload` with no SMTP call. Limits: 4 loop sends + 1 mail send to one address hold the next follow-up (`recipient_day`); loop sends count in the mailbox limits. Crash points (after claim, before SMTP, after SMTP, a throw in the commit) give one mail; 20 loops of a loop closing while the committer sends gave one outcome each, no deadlock. Existing kinds (delegation, clarification, reminder) compose byte-identical MIME. Card and expiry readers skip loop sends with no error and no log of text. `graph:modules --check`, `db:check-migrations` pass; no migration.

TG1 (proven by mutant R3; fixed in a Sonnet continue): no test checks the mailbox filter in `loops/sent-off.ts` `expireWaitingFollowUps`: without it, switching off Sent tracking on mailbox A expires mailbox B's waiting and approved follow-ups. Add a second-mailbox test.
TG2 (fixed): no concurrency test of the loop-lock order (mutant R1 is equivalent today); add one from the reviewer's probe (loop closing while the committer sends: one outcome each, no deadlock).

Carry-over (also in the stage files):
- N1 (stage 11): `onSentOff` clears the loop's To and Cc, so an approved follow-up claimed before the switch-off ends `failed / bad_payload` (the recipient check runs before `isOpen`), and after SMTP + crash + switch-off it ends `failed / outcome_unknown` with `follow_ups_sent` 0 (no second mail). `drafts-and-send.md` rule 15 ("expired / loop_closed") is not true for these cases: fixed in the continue; stage 11's failure notices must handle them.
- N2 (stages 12 and 14 writers): `subject` accepts CR/LF (`z.string().max(300)`); the CRLF text stays in header values (nodemailer folds it): strip line breaks in the writers.
- N3: duplicate addresses in To/Cc appear twice in the Cc header (cosmetic).
- N4 (stages 14 and 15): D12 says a `delegated` loop sends to the counterpart only; stage 10 allows the full loop To and Cc: the stage 14/15 writers must enforce D12.
- N5 (plausible): In-Reply-To and References are rebuilt from the current loop row at send; if the loop's `message_id` changes between the Drafts APPEND and the send, the sent headers differ from the approved Drafts copy (text unchanged).
- N6 (stage 11, already listed): `heldReason` of a loop send says "scope" because `getSend` is mail-only.
- N7 (stage 11): `detectForOrg` has no catch per detector: a `NoticeViewError` (the `RangeError` render path) from a follow-up card would stop the later detectors of that org. Add a per-detector catch with the stage 11 cards.
- N9: `actions-follow-up.test.ts` is 953 lines (the styleguide asks for about 400); the head comment of `loops/sent-off.ts` is stale (fixed in the continue).
