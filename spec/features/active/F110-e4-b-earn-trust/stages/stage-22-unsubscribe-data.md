# F110 stage 22 — Unsubscribe data: header, table, per-sender reader `[risky]`

Part of [`../plan.md`](../plan.md). Risk: migration, sync capture. First stage of the cuttable group (P6). Never build next to another migration stage; stage 03 must be migrated on the shared dev DB first.

## Step 1 — Migration and capture of `List-Unsubscribe-Post`

- **Goal:** each newly stored mail records whether it offers RFC 8058 one-click (D17).
- **Files:** one migration (`email_headers.list_unsubscribe_post boolean` null; table `unsubscribe_requests`, [interfaces.md](../interfaces.md) § Schema, tenant pattern of stage 03); `schema.ts`; `mail/imap/capture.ts` (`captureFromParsed`) and the `EmailHeaders` port type; F106 maps and `DELETE_SEEDS` (`unsubscribe_requests.sender_lower` is a third-party address: `DSR_ADDRESS_MAP`; `sender_domain` too).
- **Decisions:**
  - `true` when the topmost `List-Unsubscribe-Post` value, trimmed and case-insensitive, equals `List-Unsubscribe=One-Click`; `false` when the header is absent or other; old rows stay null (no backfill of old headers: `sync.md` rule 18).
  - `unsubscribe_requests.status` check constraint (`requested`, `done`, `failed`, `refused`); `code` holds a short code (`http_<status>`, `timeout`, `private_host`, `redirect`, `tls`), never a URL.
  - The F106 DSR erase of a sender deletes that sender's `unsubscribe_requests` rows (erase rule `delete`, not a cleaned value: a cleaned `''` would hit the unique key on the second erase; review 1 T6).
- **Test:**
  1. GreenMail: a mail with both headers → `list_unsubscribe_post` true; `List-Unsubscribe-Post: list-unsubscribe=one-click ` (case, space) → true; only `List-Unsubscribe` → false.
  2. The F106 tests pass with the new table and column (fail once without the registration).
  3. Up, down, up of the migration.

## Step 2 — Per-sender readers

- **Goal:** the newsletters view can leave out spam and suspicious senders (PD-063, F109 review-4 N5).
- **Files:** `triage/suspicious-repo.ts` (`suspiciousSendersOf`, exported from `triage/index.ts`); a `listNewsletterSenders(db, ctx, mailboxId, now)` read in the module that serves stage 23 (`trust` or `mail`; name it in the final message).
- **Interfaces:** `suspiciousSendersOf(db, ctx, mailboxId, sendersLower)` → the set of senders with at least one mail in 30 days whose newest `triage_results` row has reasons (pattern of `listFrequentSenders`; use `emails.from_address_lower`, never `lower(from_address)`: the tenant policy blocks it). `listNewsletterSenders` → per sender of the last 30 days whose mails are `notification` or `info`: `{ senderLower, fromName, count, latestAt, latestEmailId, oneClick, hasLink, spam: boolean }`, where `oneClick` and `hasLink` come from the newest mail's headers (D17: `list_unsubscribe_post` true, an `https` URI in `List-Unsubscribe`, `auth_results` with `dkim=pass` and `header.d` = the From domain or its parent domain, read only when its authserv-id is in `MAIL_TRUSTED_AUTHSERV_IDS`, the rule F109 uses (review 1 T5)). Accepted limit (review 1 N11): `dkim=pass` does not prove that the signature covers the two `List-Unsubscribe` headers, as RFC 8058 asks; stage 25 writes it into the limits.
- **Decisions:** a sender with any `spam` mail in the window or in `suspiciousSendersOf` is left out (P6). At most 200 senders, ordered by count.
- **Test** (`triage-suspicious-readers.test.ts`, a new reader test):
  4. Sender A with one suspicious mail and one clean → in the set; B clean → not.
  5. Tenant: org B's sender never appears for org A.
  6. `listNewsletterSenders`: A (suspicious) and a spam sender left out; C with both headers and `interia.pl; dkim=pass header.d=c.example` from `news@c.example`, trusted ids `interia.pl` → `oneClick` true; D with `dkim=fail` → `oneClick` false, `hasLink` true.
  7. `evil.example; dkim=pass header.d=c.example` from `news@c.example`, trusted ids `interia.pl` → `oneClick` false.
  8. DSR erase of sender A, then of sender B, both with a request row in one mailbox → both erasures succeed; no row of A or B is left.

## Done when

- Proof (`s22`) prints `PROOF_OK`.
- Final message: "U1: owner runs `bun run db:migrate` on the shared dev DB after the land."

## Out of scope

Any route or POST (stages 23, 24). `mailto:` unsubscribe.
