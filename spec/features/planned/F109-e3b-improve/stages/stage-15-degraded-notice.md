# F109 stage 15 — Degraded-mode notice during an LLM pause

Part of [`../plan.md`](../plan.md). Decisions P6, P8, D17. Needs stage 02 (outbox kind `not_triaged`). Never next to stages 04 or 06 (notice files). Review before the land (sends to people, new Polish text).

## Step 1 — Detector and notice

**Goal.** While the LLM is paused, each linked member learns that mail from a VIP or whitelisted sender waits, with the sender address only.

**Files.** New `apps/server/src/modules/channels/notices/not-triaged.ts` (a detector in the notice registry, like `weekly-report.ts`); the view and renderer in core next to the other notice renderers; flag `degraded_notice` in `packages/core/src/features.ts` (default off, epic `E3b`, remove-by `2027-03-01`, description "During an AI pause, mail from VIP and whitelisted senders gets a 'not triaged yet' notice.").

**Decisions (D17).**

- Pause source: `latestLlmPause` (F100 D8; audit rows, so it holds after a restart). No pause → nothing. The daily cap is not a pause: no notice (Q9).
- Candidate mail: status `pending`, received in the last 24 h, of an active mailbox of an organization that is not suspended, inside the triage scope (`TRIAGE_LLM_SCOPE`: `synthetic` → test mail only, `off` → nothing), whose sender matches a `vip` or `whitelist` rule (the hard-rule matcher of core).
- Not in quiet hours of the organization time zone: the detector queues nothing then. Mail that still waits at 07:00 during a pause gets its notice then.
- One notice per mail and member: dedup key `not_triaged:<email id>`. At most 5 `not_triaged` rows per mailbox since the pause's `since`; later mail gets none (rejected: one notice per mail without a cap; a whole-domain whitelist could flood the chat).
- Recipients: the members who get urgent notices for that mailbox (same rule as `urgent.ts`).
- View: `{ emailId, mailboxId, sender }`, `sender` = the `from_address`. No subject, display name, body or summary (P6).
- Texts: en `📭 Mail from <sender> is not triaged yet: the AI service is paused. It is triaged when the service is back.`; pl `📭 Wiadomość od <sender> nie jest jeszcze posortowana: usługa AI ma przerwę. Zostanie posortowana, gdy usługa wróci.` The sender goes through the chat-safe text helper.
- After the pause the mail is triaged as today; an `urgent` result sends its urgent notice as today. No "back" message.
- Log: one `info` line per run with the count of queued rows; no address.

**Test (integration, fixed clock 2027-01-15 10:00 `Europe/Warsaw`).**

1. Flag on, an `llm.call` row with a soft code 3 min old, a pending VIP mail → one `not_triaged` row per linked member; the rendered text holds the address and no subject.
2. A second tick → no new row (dedup).
3. A pending mail from an unknown sender → no row.
4. No pause (newest `llm.call` ok) → no row.
5. Flag off → no row.
6. Clock 23:00 → no row; clock 07:00 next day with the pause still active → the row.
7. Seven pending whitelisted mails in one mailbox → 5 rows per member.
8. Org B's pause does not make rows for org A's mail.
9. Renderer: en and pl text for `ceo@corp.test`; a sender with U+202E → removed.

**Check.** The new tests and the notice registry test, then the Proof.

**Done when.** Tests 1–9 pass; for each guard (flag, pause check, sender rule, `org_id` scope, cap) the worker removes it, sees its test fail, restores it; Proof `PROOF_OK`.

**Out of scope.** A second provider (F072), the daily cap, a web notice.
