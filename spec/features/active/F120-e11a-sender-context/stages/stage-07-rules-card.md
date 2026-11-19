# F120 stage 07 — Rules page card

Part of [`../plan.md`](../plan.md). Decisions P3, PD-105, PD-108. Web stage: Proof with the web tail.

Carry-over reads: `apps/web/src/islands/RulesPage.tsx`, `components/rules/NewslettersCard.tsx` and `UrgencyCard.tsx` (mailbox select, owner and member views, flag-off behaviour), `apps/web/src/lib/api.ts`, `docs/capabilities/web-panel.md`, stage 06 routes.

## Step 1 — the card

- Goal: a "Suggestions" card on the Rules page above the newsletters card, with its own mailbox select (as the newsletters card). No new tab, no page.
- Data: `GET /api/suggestions/:mailboxId`. A 404 (flag off) hides the card and makes no further request.
- Each item: the pattern, the kind as a badge, and the reason line from the counts:
  - VIP by answers: en `You answered {answered} of {received} mails in 30 days.` pl `Odpowiedziałeś na {answered} z {received} wiadomości w 30 dni.`
  - VIP by flags: en `You flagged {flagged} mails in 30 days.` pl `Oznaczyłeś flagą {flagged} wiadomości w 30 dni.`
  - Whitelist: en `You moved back or corrected {rescued} mails from spam or notifications in 90 days.` pl `Przeniosłeś z powrotem lub poprawiłeś {rescued} wiadomości ze spamu lub powiadomień w 90 dni.`
  - Blocklist: en `You marked {corrected} mails as spam in 90 days and never wrote to this sender.` pl `Oznaczyłeś {corrected} wiadomości jako spam w 90 dni i nigdy nie pisałeś do tego nadawcy.`
  - Domain: the same lines with `from {senders} senders of this domain` / `od {senders} nadawców z tej domeny` appended.
  - Polish verbs: use the form the panel already uses for the user (grep `en.ts`/`pl.ts` for an existing second-person past tense; if the panel uses an impersonal form, follow it). The review of this stage checks the Polish.
- Owner: buttons Accept and Dismiss. Accept → toast `Rule added` / `Reguła dodana`; `rule_limit` → toast with the limit text that `AddRuleForm` uses; `already` → refresh the list silently. Dismiss → the item leaves; toast `Hidden for 90 days` / `Ukryte na 90 dni`. After Accept the rule list of the page reloads.
- Member: the list without buttons and one line `Only an owner can accept suggestions.` / `Tylko właściciel może przyjąć sugestie.`
- Empty list: `No suggestions now. They appear when your mail shows a clear pattern; at most 3 a week.` / `Brak sugestii. Pojawiają się, gdy poczta pokazuje wyraźny wzór; najwyżej 3 w tygodniu.`
- Every string through `t()` / `tp()` in `en.ts` and `pl.ts`.
- Pure state rules in `apps/web/src/lib/suggestions-view.ts`.

## Test

- Unit (`suggestions-view.test.tsx`):
  1. VIP `{received: 8, answered: 6}` → the en reason text exactly.
  2. VIP `{flagged: 3}` → the flags text.
  3. Domain blocklist `{corrected: 4, senders: 2}` → the domain suffix.
  4. Member view → no button.
  5. 404 → card hidden.
- E2E (`apps/web/e2e/tests/suggestions.spec.ts`, seeded flag on, one VIP and one blocklist suggestion):
  1. Owner sees 2 items; Accept VIP → the item leaves and the rule list shows the VIP rule.
  2. Dismiss the blocklist item → it leaves; reload → still gone.
  3. Member sees the items and no buttons.
  4. axe check of the card passes (as the other e2e tests).

## Done when

All tests pass. Then the Proof command with the web tail.

## First commit of this stage (carry-over from the stage 06 review, PASS a9aee92c)
Backend hardening before the card (small, with tests and a mutation log each):
- N1: `acceptSuggestion` for a blocklist row re-runs the protection check of `suggestionsFor` (delegate, Sent reply, known domain). If the sender is now protected, withdraw the row and answer 409 `not_available`; no rule is added. Counter-example to pin: open blocklist suggestion `spam@acme.pl`, then an active delegate `spam@acme.pl` is added, then accept gives 409 and no rule. The web card must show the 409 as "the suggestion is no longer valid".
- TG-1: test 8 (no address in logs) also wraps the dismiss call in `captureLogs()`.
- N2: a dismiss on a paused mailbox answers 404 like accept (symmetric).
- N3 (decision to record, no change): the weekly suggestion line goes to every report member, not only owners; the count is org-wide like the other week stats.
