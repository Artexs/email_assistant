# F116 stage 19 — Telegram taps

Part of [`../plan.md`](../plan.md). `[risky]` (sending to people, roles, Polish text). Needs stages 16 and 18.

## Step 1 — Callbacks (core)

- **Goal:** the callback kinds of `interfaces.md` in `core/digest/callback.ts`.
- **Decisions:** `lf`, `ll`, `lc`, `lx`, `lr` take a loop UUID and `dg` an email UUID (the existing encoder). `dp` holds two UUIDs as 22-character base64url each (`dp:<email>:<delegate>`, 48 bytes, F6); the parser turns them back to UUIDs and refuses any other length.
- **Test (unit):** T1 every prefix is unique (the existing test extended); T2 round trip of `dp` with `0e0b7a52-6c1f-4d0e-9a31-5f2c8d1e7b40` and `f3a1c9d2-1111-4abc-8def-000000000001` → the same ids, value ≤ 64 bytes; T3 `dp:` with a 21-character part → null.

## Step 2 — Loop line buttons

- **Goal:** the brief lines of stage 18 get buttons; the taps call the stage 14 commands with `via: "telegram"`.
- **Decisions:**
  - Waiting and delegated lines: [📝 Draft follow-up] [⏰ Later] [✓ Done]; shadow: no Draft button; `later_count = 3`: no Later; a waiting follow-up: no Draft. Promised lines: [✓ Done] [✖️ Drop]. Delegation lines (from `delegations`): [✓ Done] (the existing `dd:`). The "⌛ Closed without an answer" line: [↩️ Reopen] (`lr:`). One keyboard row per line. Uncovered users (D17): no loop buttons.
  - Answers (toast, pl and en): `planned` → "Follow-up drafted. Check the card." (the card comes from the stage 11 detector); `would_draft` → "Shadow mode: no draft."; `waiting` → "A follow-up already waits for your approval."; `limit_reached`, `too_soon`, `closed`, `suspicious` ("This thread looks suspicious: no follow-up."), `drafts_off`, `not_allowed`, `feature_off` → one fixed text each. Later → "Moved to {date}."; Done → "Done."; Drop → "Dropped."
  - After a state change the bot edits the brief message: the tapped line gets a status mark (✓, ⏰, ✖️) and its buttons go; the rest of the message stays (the card-edit rule of `docs/code-patterns.md`: never render the whole message again).
  - Roles (D11): Done, Later any linked member; Draft, Drop, Reopen owners (`taps.ownerOnly`). The org and user come from the chat link, never from the callback.
- **Test (integration):** T4 an owner taps `lf` on a waiting loop in `assist` → a follow-up pair; the toast text; the line edited; T5 a member taps `lf` → owner-only answer, no pair; T6 `ll` three times → "Moved to …", the fourth tap has no button (render) and the command answers `limit_reached`; T7 a loop id of org B → the same answer as an unknown id; T8 the tap on a closed loop → "closed" text.

## Step 3 — Delegate button and picker

- **Goal:** [👥 n] on the action-section rows of the digest (urgent, needs reply, unsure) and on urgent notices; a tap opens a picker; a pick calls `delegateMail` (stage 16).
- **Decisions:**
  - Shown only when flag `delegate_button` is on, the org has an active delegate and the mailbox is in `assist` with `create_draft` on (questions.md 6). The row keeps its ✅, ✏️, ↩️; two rows share a keyboard line, so a line holds at most 8 buttons.
  - `dg:<email>` → the bot sends one picker message "Delegate to:" with up to 8 active delegates by name (`dp:` buttons) and, when there are more, "More delegates in the panel" with the link.
  - `dp` → `delegateMail` → `planned` "Delegation drafted. Check the card."; `exists` "This mail already has a delegation."; `delegate_inactive`, `not_delegable`, `drafts_off` → one text each. The picker message is edited to the result line.
  - Owners only.
- **Test (integration):** T9 a digest row of `needs_reply` has [👥 n]; an `info` row has none; no active delegate → none; T10 `dg` → a picker with 2 delegates; 9 delegates → 8 buttons and the panel line; T11 `dp` → a `drafted` delegation with `source = button`; a second `dp` → "already" text; T12 an urgent notice has the button.

## Check

`bun test packages/core/src/digest apps/server/test/integration/<the touched channels tests>`

## Done when

T1–T12 pass; the Proof of `plan.md` prints `PROOF_OK` (`/tmp/f116-s19`).

## Out of scope

Routes and panel (20–22).

## Carry-over from stage 12 review

- The loop text (ask, subject) can hold markdown and the remains of an escape sequence: escape it in the brief and in the Telegram cards (review-12.md N6).

## Carry-over from stage 17 review

- N5: the keyboard builder drops the loop buttons when loopConsent is false (use the stage 11 choke point) (review-17.md).
