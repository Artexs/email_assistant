# F113 stage 09 — executive rules

Part of [`../plan.md`](../plan.md). Decisions D10, D11. Review 1: B2, T2, T3, N7.

## Goal

Pure rules: for a Telegram card and the slot truth behind it, which button the executive presses, and when.

## Files

`packages/core/src/sim/live/executive.ts` with tests.

## Interfaces

```ts
type ExecCardKind = "approval" | "reminder_set" | "send_failed" | "reject_reason" | "feedback" | "other";
type ExecCard = {
  kind: ExecCardKind;
  messageId: number;              // the Telegram message that holds the buttons
  buttons: string[];              // callback data of this card only, as parseCallback reads it
  actionId?: string; setId?: string; emailId?: string;
  draft?: { kind: "delegation" | "clarification" | "other"; recipient: string };
  moved?: boolean;                // the card reports an automatic move out of the INBOX
};
type ExecTruth = { category: Category; expectedDraft?: "delegation" | "clarification" | "none"; expectedDelegateAddress?: string } | null;
type ExecAction = { press: string; then?: "reason_wrong_person" | "reason_not_needed" } | { press: null; count?: "unmapped" | "no_rule" };
executiveDecision(card: ExecCard, truth: ExecTruth, memory: { sentAgain: boolean; pendingReason?: "p" | "n" }): ExecAction;
executiveTapAt(cardAt: string, seed: number): string;   // UTC ISO
cardsOf(messageId: number, buttons: string[]): ExecCard[];   // one card per action, set or email id in the buttons
```

## Decisions (rules, first match wins)

1. `truth` null (the card's mail is not a lab mail of this run) → no press, `unmapped`.
2. `approval`, draft `delegation`: truth category not `delegation` → `ar:`, `then: reason_not_needed` (review T3). Recipient = `expectedDelegateAddress` (case-insensitive) → `ap:`. Else `ar:`, `then: reason_wrong_person`.
3. `approval`, draft `clarification`: `expectedDraft` = `clarification` → `ap:`; else `ar:`, `then: reason_not_needed`.
4. `approval`, any other draft → `ar:`, `then: reason_not_needed`.
5. `reject_reason` with `pendingReason` → press `rw:p:<id>` or `rw:n:<id>`. Without `pendingReason` → no press, `no_rule`.
6. `reminder_set` → press `as:`.
7. `send_failed` → `ag:` once (`sentAgain` false); after that no press.
8. `feedback` with an Undo button, `moved` true and truth `urgent`, `needs_reply` or `delegation` → press `fu:`. Else no press.
9. Anything else → no press, `no_rule`.

- **One message, many cards** (review T2): a digest message holds `fr:`, `fe:`, `fu:` buttons for several mails. `cardsOf` groups the buttons by the id in their data; each group is one card (kind from its prefixes). A reject turns the approval message into a reason card in place (the same `messageId`, new `rw:` buttons; review B2).
- No rule presses `fr:`, `fe:`, `fc:`, `fx:`, `v*:`, `ay:`, `an:`, `gw:`, `dd:` or `mk:` (PD-021: approve, reject, Undo).
- `executiveTapAt`, Warsaw time: weekdays 08:00–18:00, weekends 10:00–11:00. Tap time = the start point plus 5–90 min (seeded). The start point is `cardAt` when it lies in a window, else the next window start. The tap may fall after the window end. The longest gap (Saturday 11:00 to Sunday 10:00) is 23 h, inside the 48 h approval time (review N7).
- `seed` = a hash of run id and card key (the caller computes it; core uses `mulberry32`).

## Tests (fixed values)

1. Delegation draft to `magdalena.czerniak@kordelan.test`, truth expects the same address in upper case → press `ap:<id>`.
2. Same draft, truth expects `dorota.wilczynska@kordelan.test` → `ar:<id>`, `then: reason_wrong_person`.
3. Clarification draft, `expectedDraft` `clarification` → `ap:`; `none` → `ar:` with `reason_not_needed`.
4. `reject_reason` with `pendingReason` `p` → `rw:p:<id>`.
5. `reminder_set` → `as:<setId>`.
6. `send_failed`, `sentAgain` false → `ag:<id>`; true → no press.
7. Feedback card, moved, truth `urgent` → `fu:<emailId>`; truth `spam` → no press; not moved → no press.
8. Truth null → `unmapped`.
9. A card that has only `fr:` and `fe:` buttons → no press.
10. `executiveTapAt`: Mon 2026-11-23 07:00 Warsaw → within [08:05, 09:30]; Mon 12:00 → within [12:05, 13:30]; Fri 17:50 → Fri [17:55, 19:20]; Fri 18:30 → Sat [10:05, 11:30]; Sun 23:00 → Mon [08:05, 09:30]. Same seed → same time.
11. `cardsOf`: `["ap:x","ar:x"]` → one `approval`; `["as:s","rs:s"]` → one `reminder_set`; `["rw:p:x","rw:c:x","rw:n:x"]` → one `reject_reason`; a digest with `fr:`/`fe:`/`fu:` for mails a, b, c → three `feedback` cards, each with its own `emailId` and 3 buttons.
12. A delegation draft whose truth is `info` → `ar:` with `reason_not_needed`.

## Done when

Tests 1–12 pass; the Proof prints `PROOF_OK`.

## Out of scope

Reading the fake Telegram and the DB (stage 10).
