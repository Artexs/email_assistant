# F112 stage 07 — Tutorial and FAQ (en)

Part of [`../plan.md`](../plan.md). Read P2, P6, D7, D8 and § Rules (truth rule). Needs stage 06. Sources: `docs/capabilities/` (web-panel, sync, triage, digest-and-notices, actions-and-undo, tenancy-and-plans), `docs/product-brief.md`, the panel texts `apps/web/src/i18n/en.ts`.

Two steps. Markdown about 350 lines.

## Shared rules for content stages (07–10)

- Diátaxis: a tutorial teaches by doing one path; a how-to answers one task; a reference lists facts; an explanation says why.
- Each page: `title`, `description` (one sentence), `capabilities`. Panel labels only through `<UiText k="…" />` (`.mdx` pages); Telegram buttons and commands as the code writes them (emoji included).
- Plain English, short sentences, second person ("you"). No promise beyond a capability page. No date, version or person.
- Screenshots: none yet; stage 11 adds `<Shot>` tags.
- A page id in `apps/docs/src/site-map.test.ts` (new in this stage): the test lists the expected page ids of `src/content/docs` and the in-place pages and fails on a missing or extra page. Each content stage adds its ids.
- A fact that no capability page or code shows is a question in the final message, not a sentence.

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
  7. Next steps: links to how-to pages (stage 08) and the explanation of shadow and assist (stage 09). Links to pages that do not exist yet are not allowed by the link check: add them in the stage that writes the target, or write the text without a link now.
- **capabilities:** `web-panel`, `sync`, `digest-and-notices`, `tenancy-and-plans`.
- **Test:**
  - T1: `bun run docs:build` passes (front matter, links, public content).
  - T2: `site-map.test.ts` passes with `index`, `start`, `operate/install-and-run`.
  - T3: `bun run docs:stale` exits 0 (`POLISH_SET` stays `["index"]`; stage 10 adds the Polish set, so CI stays green).
- **Done when:** T1–T3 hold.

## Step 2 — FAQ (usage)

- **Goal:** short answers to the questions a new user asks in the first week.
- **Files:** `apps/docs/src/content/docs/faq.mdx`, `site-map.test.ts`.
- **Content:** 8–12 questions, each answer 1–4 sentences with a link to the page that holds the detail. At least: Which mail services work (IMAP with a password; the allowed-host rule)? Does it ever send a mail without me? What does Telegram receive (no mail bodies)? What happens in shadow mode? How do I undo a move? Why is a mail `unsure`? Can I use it in Polish? What happens when the account is paused? Trust questions (who holds a copy, training, where it is processed) get one line: the security page comes later (no link, no claim).
- **capabilities:** `triage`, `actions-and-undo`, `drafts-and-send`, `digest-and-notices`, `sync`.
- **Test:**
  - T4: `bun run docs:build` passes; `site-map.test.ts` passes with `faq` added.
- **Done when:** T4 holds; the final message lists each FAQ claim with its capability page and rule number.

## Proof

The plan's chain with `NN` = `07`, then `&& bun run docs:stale > /tmp/f112-s07/stale.log 2>&1` before `&& echo PROOF_OK`.
