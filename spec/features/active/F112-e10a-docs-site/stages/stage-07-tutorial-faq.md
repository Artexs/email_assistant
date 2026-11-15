# F112 stage 07 — Tutorial and FAQ (en)

Part of [`../plan.md`](../plan.md). Read P2, P6, D7, D8. Needs stage 06. Sources: `docs/capabilities/`, the code at `HEAD`, `apps/web/src/i18n/en.ts`.

Two steps. Markdown about 350 lines.

## Shared rules for content stages (07–10, 12)

- Diátaxis: a tutorial teaches one path; a how-to answers one task; a reference lists facts; an explanation says why.
- Each page: `title`, `description` (one sentence), `capabilities`. Panel labels only through `<UiText k="…" />`; Telegram buttons and commands as the code writes them (emoji included).
- Plain English, short sentences, "you". No date, version or person.
- **Flags per sentence (P2):** no button, digest line, field, command or route that a default-off flag gates, also inside an unflagged feature (for example the `mistake_capture` button, the `handled_share` and `llm_pause_line` digest lines, the `answered_check` block).
- **Code wins (P2):** when a capability page and the code disagree, write what the code does and name the conflict in the final message.
- `apps/docs/src/site-map.test.ts` (new in this stage) lists the source page ids (`src/content/docs` files and `IN_PLACE_PAGES`), not the built pages: Starlight's `/pl/` fallback pages (F7) are not in it. It fails on a missing or extra id. Each content stage adds its ids.
- `apps/docs/src/flagged-text.test.ts` (new in this stage): `FLAGGED_TEXT: { flag: string; text: string }[]`, the user-visible strings of every default-off flag (from `features.ts`, the capability pages and the texts in `packages/core/src/texts` and `apps/web/src/i18n`, en and pl). The test fails when a doc page holds one while its flag defaults off. A stage that meets a new flagged string adds it.

## Step 1 — Tutorial `start`

- **Goal:** a new user goes from the invite link to the first digest in one path.
- **Files:** `apps/docs/src/content/docs/start/index.mdx` (one page, numbered sections), `site-map.test.ts`, the landing page link.
- **Content** (this order; each step says what you see and what the system does):
  1. What you need: an invite link from your operator (24 h, one use), the mailbox address and its password, Telegram on your phone.
  2. Set your password and accept the terms (`/setup`; 12–128 characters; the leaked-password check).
  3. Sign in; the optional two-factor step (link to the how-to of stage 08).
  4. The Onboarding checklist: connect a mailbox (what "Server not allowed" means for you); link Telegram (the consent text); keep shadow mode or choose the mode; add sender rules (optional).
  5. Shadow mode: the system sorts and reports, changes nothing in your mailbox; the digest line "Shadow mode: …".
  6. Your first digest at 08:00 or 16:00 (organization time zone); the buttons `✅ n` and `✏️ n`; `/digest` for one now.
  7. Next steps, as text without links (the link check fails on a missing page; stages 08 and 09 add the links).
- **capabilities:** `web-panel`, `sync`, `digest-and-notices`, `tenancy-and-plans`.
- **Test:**
  - T1: `bun run docs:build` passes (front matter, links, public content).
  - T2: `site-map.test.ts` passes with `index`, `pl/index`, `start`, `operate/install-and-run`; `flagged-text.test.ts` passes and holds at least one string per default-off flag that a user can see.
  - T3: `bun run docs:stale` exits 0 (`POLISH_SET` stays `["index"]`; stage 10 adds the Polish set, so CI stays green).
- **Done when:** T1–T3 hold.

## Step 2 — FAQ (usage)

- **Goal:** short answers to the questions a new user asks in the first week.
- **Files:** `apps/docs/src/content/docs/faq.mdx`, `site-map.test.ts`.
- **Content:** 8–12 questions, each answer 1–4 sentences with a link to the page that holds the detail. At least: Which mail services work (IMAP with a password; the allowed-host rule)? Does it ever send a mail without me? What does Telegram receive (no mail bodies)? What happens in shadow mode? How do I undo a move? Why is a mail `unsure`? Can I use it in Polish? What happens when the account is paused? Trust questions (copy, training, location): no answer here; F121 writes the security page.
- **capabilities:** `triage`, `actions-and-undo`, `drafts-and-send`, `digest-and-notices`, `sync`.
- **Test:**
  - T4: `bun run docs:build` passes; `site-map.test.ts` passes with `faq` added.
- **Done when:** T4 holds; the final message lists each FAQ claim with its capability rule.

## Proof

The plan's chain with `NN` = `07`, then `&& bun run docs:stale > /tmp/f112-s07/stale.log 2>&1` before `&& echo PROOF_OK`.
