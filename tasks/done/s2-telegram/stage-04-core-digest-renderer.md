# s2-telegram — Stage 4

Part of [`../s2-telegram.md`](../s2-telegram.md). Read that file's "Input" and "Rules for every step" first.

## Stage 4 — Core: digest renderer [risky]

- [x] **4.1 `renderDigest`: sections, lines, counts, "last sync", buttons, the 4096 limit**
  - Goal: one pure function turns the digest data into one message with at most 15 lines and their ✅ / ✏️ buttons (P2, P3); "last sync" is always there, also when the digest is empty.
  - Files: create `packages/core/src/digest/digest.ts`, `packages/core/src/digest/digest.test.ts`; export from `packages/core/src/digest/index.ts`.
  - Interfaces:
    - `const DIGEST_MAX_LINES = 15`
    - `interface DigestMailbox { id: string; address: string; status: "active" | "auth_error" | "paused"; lastSyncedAt: Date | null; statusChangedAt: Date; mode: MailboxMode }`
    - `interface DigestItem { emailId: string; category: Category; from: string | null; subject: string | null; receivedAt: Date; synthetic: boolean; aiText: string | null; wouldDo: string }` — no body field: the digest never gets mail bodies (ADR 0005).
    - `interface DigestInput { kind: "scheduled" | "on_demand"; now: Date; timeZone: string; slot: { date: string; time: string; late: boolean } | null; periodStart: Date; mailboxes: readonly DigestMailbox[]; counts: Partial<Record<Category, number>>; items: readonly DigestItem[]; skippedTooOld: number; waiting: number; maxLines?: number }` — `counts` = all mail of the period by category; `items` = the line candidates (the caller gives at most 100); `slot` is set only for `scheduled` (`date` and `time` are the local slot, step 2.2).
    - `renderDigest(input: DigestInput): OutMessage`
  - Decisions (lines joined with `\n`; `clock(x)` = `formatClock(x, timeZone, now)`; `sync(x)` = `x === null ? "never" : clock(x)`):
    - **Header** (first line): scheduled → `` `📬 Digest ${slot.time} · ${formatDay(localToInstant(slot.date, slot.time, timeZone), timeZone)}` `` plus `" (late)"` when `slot.late` (the day of the slot, not of the send: a late 23:30 digest sent after midnight still shows its own day); on demand → `` `📬 Digest now · ${formatDay(now)} ${localDateTime(now).time}` ``.
    - **Since line:** `total` = the sum of `counts`; `needsAction` = `urgent + needs_reply + delegation + unsure` counts. `total > 0` → `` `Since ${clock(periodStart)}: ${total} mail(s), ${needsAction} need action` `` (`"1 mail"`, `"2 mails"`); `total = 0` → `` `No new mail since ${clock(periodStart)}.` ``.
    - **Mailbox lines** (always; one per mailbox, input order; `suffix` = `` ` · ${cutText(address, 40)}` `` only when there is more than one mailbox):
      - `active`, synced at most 30 min ago → `` `🔄 Last sync ${clock(lastSyncedAt)}${suffix}` ``
      - `active`, older than 30 min → `` `⚠️ Last sync ${clock(lastSyncedAt)} (late)${suffix}` ``; never synced → `` `⚠️ Last sync: never${suffix}` ``
      - `paused` → `` `⏸ Paused since ${clock(statusChangedAt)} · last sync ${sync(lastSyncedAt)}${suffix}` ``
      - `auth_error` → `` `❌ Login error since ${clock(statusChangedAt)} · last sync ${sync(lastSyncedAt)}${suffix}` ``
      - no mailbox at all → one line `Last sync: no mailbox connected`.
    - **Order of the line candidates:** section NEEDS ACTION = `urgent`, `needs_reply`, `delegation`, `unsure`; section OTHER MAIL = `info`, `notification`, `spam`. Sort by section, then by the category order above, then `receivedAt` newest first, then `emailId`. `listed` = the first `maxLines ?? DIGEST_MAX_LINES` items.
    - **Item block** (`n` = the position in `listed`, from 1, continuous over both sections):
      ```
      <n>. <categoryTag(category)> · <senderLabel(from)>     (+ " · 🧪 test" when synthetic)
      <cleanSubject(subject)>
      💬 <cutText(aiText, 120)>                              (left out when aiText is null or empty)
      → <wouldDo>
      ```
      One empty line between blocks.
    - **Section headers:** `` `NEEDS ACTION · ${count}` `` and `` `OTHER MAIL · ${count}` `` (count = the `counts` of the section's categories), each followed by its listed blocks; a section without a listed block has no header. One empty line before each header.
    - **Footer** (only the lines that apply, after one empty line):
      - `+N more`: per category, `counts[c] − listed count of c` (never below 0). Sum > 0 → `` `+${sum} more: ${parts.join(", ")}` `` with parts `` `${n} ${name}` `` in category order; names: `urgent`, `reply`, `delegate`, `unsure`, `info`, `notification`, `spam`.
      - `skippedTooOld > 0` → `` `📭 Not processed (older than 7 days): ${skippedTooOld}` ``
      - `waiting > 0` → `` `⏳ Waiting for triage: ${waiting}` ``
      - `total > 0` and every mailbox has mode `shadow` → `Shadow mode: the system changed nothing in your mailbox.`
    - **Buttons:** for each listed item ``feedbackButtons(emailId, category, { right: `✅ ${n}`, edit: `✏️ ${n}` })`` (step 3.3: an `unsure` or `delegation` item has only ✏️). Rows: the buttons of two items per row (items 1+2, 3+4, …).
    - **4096 limit (P3, cut not split):** render; while `text.length > MESSAGE_MAX_CHARS` and `listed` is not empty, remove the last listed item (it moves into `+N more`) and render again. If the text is still too long with no item (more than about 40 mailboxes, not expected), cut it to the first 4095 UTF-16 units without breaking a surrogate pair, add `…`, and return no buttons. `text.length` (UTF-16 units) is never smaller than Telegram's count.
  - Test (`digest.test.ts`, `Europe/Warsaw`, now `2026-11-06T07:00Z`, period start `2026-11-05T15:00Z`, one `active` `shadow` mailbox synced at `06:55Z`, unless said):
    1. Empty (counts `{}`, items `[]`, slot `{ date: "2026-11-06", time: "08:00", late: false }`): the text is exactly `📬 Digest 08:00 · Fri 6 Nov\nNo new mail since 5 Nov 16:00.\n🔄 Last sync 07:55`; buttons `[]`.
    2. Ordering: one item of each of the 6 categories (no delegation) with different times → the block order is urgent, needs_reply, unsure, info, notification, spam; numbers 1–6; the `unsure` item has only `✏️ 3`; headers `NEEDS ACTION · 3` and `OTHER MAIL · 3`; the since line says `6 mails, 3 need action`; the shadow line is there.
    3. 20 items (counts equal) → 15 blocks; `+5 more: …` with the right numbers per category; 8 button rows; the last row has the buttons of item 15 only.
    4. Worst case: 15 items with `from` of 300 characters, `subject` of 1000 characters with emoji, `aiText` of 2000 characters, `wouldDo` `"would mark read, move to AI/Notifications"`, 10 mailboxes with 60-character addresses → `text.length ≤ 4096`; every button belongs to a listed item; the `+N more` count includes the dropped items.
    5. `maxLines: 3` → 3 blocks.
    6. Headers: `late: true` → `📬 Digest 08:00 · Fri 6 Nov (late)`; slot `{ date: "2026-11-06", time: "23:30", late: true }` with now `2026-11-06T23:10Z` (00:10 on 7 Nov) → `📬 Digest 23:30 · Fri 6 Nov (late)`; on demand at `13:05Z` → `📬 Digest now · Fri 6 Nov 14:05`.
    7. Mailbox lines: synced at `06:20Z` → `⚠️ Last sync 07:20 (late)`; never synced → `⚠️ Last sync: never`; `paused` since `2026-11-05T13:00Z`, synced `12:55Z` → `⏸ Paused since 5 Nov 14:00 · last sync 5 Nov 13:55`; `auth_error` since `06:40Z`, synced `06:35Z` → `❌ Login error since 07:40 · last sync 07:35`; two mailboxes → each line ends with ` · <address>`.
    8. A synthetic item → its first line ends with `· 🧪 test`.
    9. `skippedTooOld: 1`, `waiting: 2` → both footer lines; zero → no such lines.
    10. One mailbox in mode `assist` → no shadow line.
    11. Every button data is ≤ 64 bytes and parses with `parseCallback` to the item's e-mail id.
    12. `aiText` null → the block has no `💬` line.
  - Check: `bun run lint && bun run typecheck && bun run test:unit`
  - Done when: the tests pass.
  - Out of scope: reading the data (stage 9), sending (stage 11), the weekly "handled share" line (S3: in shadow mode nothing is applied yet).
