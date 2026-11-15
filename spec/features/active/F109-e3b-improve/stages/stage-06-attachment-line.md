# F109 stage 06 — Attachment line in notices

Part of [`../plan.md`](../plan.md). Decisions P2, P8, D8. Needs stage 04 (same renderers; never next to 04 or 15).

## Step 1 — Pure line builder

**Goal.** One function makes the attachment line from captured metadata.

**Files.** New helper next to the digest text helpers in `packages/core/src/digest/`.

**Interface.** `attachmentLine(input: { attachments: { name: string | null; type: string; size: number; inline: boolean }[]; count: number }, lang: "pl" | "en"): string | null`.

**Decisions (D8).**

- Inline parts are left out (they are images in a signature). `text/calendar` parts are left out too (the calendar case has its own signal).
- No attachment → `null` (no line).
- Line: `📎 <n>: <name> (<size>), <name> (<size>)`; at most 3 names, then `+<k>` (en `+2 more`, pl `+2 więcej`). A name goes through the chat-safe text helper (one line, no control or bidi characters) and is cut to 40 code points. A null name shows as the type (`application/pdf`).
- Size: under 1,024 bytes `B`, under 1 MiB `kB` with no decimals, else `MB` with one decimal; Polish uses a decimal comma (`1,4 MB`).
- After retention the list is `[]` while `count` > 0: the line is `📎 <count>` only.
- Never the file, never its content. Names are mail data: the line goes to Telegram only inside notices that already carry the subject (urgent notice, digest row).

**Test (unit).**

1. `[{ name: "faktura.pdf", type: "application/pdf", size: 122880, inline: false }]`, count 1, en → `📎 1: faktura.pdf (120 kB)`.
2. Five non-inline attachments, en → three names and `+2 more`; pl → `+2 więcej`.
3. One inline image and nothing else → `null`.
4. `[]` with count 2 → `📎 2`.
5. Size 1,468,006, pl → `1,4 MB`; en → `1.4 MB`.
6. A name with U+202E and a newline → both removed; a 60-character name → 40 code points.

## Step 2 — Wire into the urgent notice and the digest

**Goal.** With the flag `attachment_line` on, both notices show the line.

**Files.** Flag `attachment_line` in `packages/core/src/features.ts` (default off, epic `E3b`, remove-by `2027-03-01`, description "Notices list the attachments of a mail (name, size)."). The urgent notice queue and the digest builder read `email_headers.attachments` and `attachment_count`.

**Decisions.** The notice fact (F088) stores the built input (names, types, sizes) only when the flag is on at queue or build time; the renderer prints the line after the subject line. Old facts without the field render as today. The web activity row is out of scope (E4 owns the panel detail).

**Test (integration).** 7. Flag on: an urgent mail with one PDF → the sent text holds `📎 1: …`. 8. Flag off → no line, the text as today. 9. A mail without an `email_headers` row → no line, no error.

**Check.** The new tests and the changed notice tests, then the Proof.

**Done when.** Tests 1–9 pass; Proof `PROOF_OK`.

**Out of scope.** Attachments in the prompt (stages 08–11), the web panel.

## Carry-over from stage 04 review

- Attachment names or types in Telegram are a new kind of mail-derived data: this stage bumps `TELEGRAM_CONSENT_VERSION` and the consent text (`tg_consent_*`, en and pl) in the same commit as the line, and lists attachment names in the consent text. Source: `review-4.md` N2.
