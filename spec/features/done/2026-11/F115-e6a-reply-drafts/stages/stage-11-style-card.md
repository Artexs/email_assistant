# F115 stage 11 — Style card in the panel

Part of [`../plan.md`](../plan.md). Needs 10. Web stage; new Polish text (Opus review).

The mailbox settings page gets the switch "Reply drafts" and a style card: display name, signature, writing style with a short guided form, and Preview.

## Step 1 — The switch row

- **Goal:** the mailbox settings card shows "Reply drafts" next to the other switches, owner editable, member read-only, with one help line: "Drafts a reply for mail that needs your answer. Nothing is sent without your tap." Hidden while the org flag `reply_drafts` is off (`/api/me` flags). For an OAuth mailbox (D19) the toggle shows disabled with "Reply drafts work only for mailboxes connected with a password for now." (en, pl); the style card stays editable.

## Step 2 — The style card

- **Goal:** a card per mailbox (on the mailbox page, below the settings card). The org `SignatureCard` becomes read-only (review G9: after the stage 03 copy, an org edit would change nothing): it shows the old text with "Signatures are set per mailbox now" and a link to each mailbox card. The org route stays for E6b's contract step; the panel no longer calls its write. Decision (review 3 N5, set in stage 03b): a null profile signature falls back to the org `style_text` (read-only from now), so the card shows `fallbackSignature` as the text in use. An empty signature field means "use the organization text" until E6b drops `style_text`.
- **Decisions:** PD-079; notes §3.9. Fields: display name (one line), signature (multi-line), writing style (multi-line, counter "n / 1000"). The guided form above the free field: form of address (`formal` / `first name` / `mirror the sender`), greeting (free, one line), sign-off (free, one line), length (`short` / `normal`). "Apply" writes these into the writing-style text as plain sentences in the owner's locale (a pure function in `packages/core/src/replies/style-form.ts`, unit-tested); the owner can edit the text after that. The form keeps no state of its own: only the text is saved. Preview calls the preview route with the unsaved values and shows the body below, with "This is a sample. Nothing was sent."; the button is disabled while a call runs.
- **Test:**
  1. Unit: `styleFromForm({ address: "formal", greeting: "Dzień dobry", signOff: "Pozdrawiam", length: "short" }, "pl")` → a fixed Polish text; the same in `en`.
  2. e2e: an owner saves a display name and a signature, reloads, sees them; a member sees the fields read-only.
  3. e2e: Preview with the fake LLM shows the sample body.
  4. e2e: zero axe violations on the page; `cspErrors` empty; the keyboard reaches every field and button in order.
  5. Unit: each new key exists in `en.ts` and `pl.ts`.
- **Check:** the touched tests, then the Proof below.

## Proof (web)

```
mkdir -p /tmp/f115-s11 && bun run lint > /tmp/f115-s11/lint.log 2>&1 && bun run typecheck > /tmp/f115-s11/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f115-s11/unit.log 2>&1 && bun run test:int:ci > /tmp/f115-s11/int.log 2>&1 && bun run web:build > /tmp/f115-s11/web.log 2>&1 && grep -q 'csp checked in' /tmp/f115-s11/web.log && flock /tmp/email-assistant-shared-tests.lock env CHROMIUM_PATH=/usr/bin/chromium bun run test:e2e > /tmp/f115-s11/e2e.log 2>&1 && echo PROOF_OK
```

Own e2e DB first (as F102 web stages do, name `f115_s11_e2e`). Never `web:dev`.

- **Done when:** the Proof prints `PROOF_OK`.
- **Out of scope:** sample drafts on real mail (16), the approvals page (15).
