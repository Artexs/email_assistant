# F113 stage 08 — executive rules

Part of [`../plan.md`](../plan.md). Decisions D10, D11.

## Goal

Pure rules for the scripted executive: for a Telegram card and the slot truth behind it, which button to press, and when.

## Files

`packages/core/src/sim/live/executive.ts` with tests.

## Interfaces

```ts
type ExecCardKind = "approval" | "reminder_set" | "send_failed" | "reject_reason" | "feedback" | "other";
type ExecCard = {
  kind: ExecCardKind;
  buttons: string[];              // callback data of the card, as parseCallback reads it
  actionId?: string; setId?: string; emailId?: string;
  draft?: { kind: "delegation" | "clarification" | "other"; recipient: string };
  moved?: boolean;                // the card reports an automatic move out of the INBOX
};
type ExecTruth = { category: Category; expectedDraft?: "delegation" | "clarification" | "none"; expectedDelegateAddress?: string } | null;
type ExecAction = { press: string; then?: "reason_wrong_person" | "reason_not_needed" } | { press: null; count?: "unmapped" | "no_rule" };
executiveDecision(card: ExecCard, truth: ExecTruth, memory: { sentAgain: boolean; pendingReason?: "p" | "n" }): ExecAction;
executiveTapAt(cardAt: string, seed: number): string;   // UTC ISO
cardKindOf(buttons: string[]): ExecCardKind;             // from the callback prefixes
```

## Decisions (rules, first match wins)

1. `truth` null (the card's mail is not a lab mail of this run) → no press, `unmapped`.
2. `approval`, draft `delegation`: recipient = `expectedDelegateAddress` (case-insensitive) → press `ap:`; else press `ar:`, `then: reason_wrong_person`.
3. `approval`, draft `clarification`: `expectedDraft` = `clarification` → `ap:`; else `ar:`, `then: reason_not_needed`.
4. `approval`, any other draft → `ar:`, `then: reason_not_needed`.
5. `reject_reason` with `pendingReason` → press `rw:p:<id>` or `rw:n:<id>`. Without `pendingReason` → no press, `no_rule`.
6. `reminder_set` → press `as:`.
7. `send_failed` → `ag:` once (`sentAgain` false); after that no press.
8. `feedback` with an Undo button, `moved` true and truth `urgent`, `needs_reply` or `delegation` → press `fu:`. Else no press.
9. Anything else → no press, `no_rule`.

- No rule presses a relabel (`fr:`, `fe:`, `fc:`, `fx:`), `/review` (`v*:`), answered-check (`ay:`, `an:`), `gw:`, `dd:` or `mk:` button. The executive stays inside PD-021 (approve, reject, Undo; edit is a later seam).
- `executiveTapAt`, Warsaw time: weekdays 08:00–18:00, weekends 10:00–11:00. Tap time = the start point plus 5–90 min (seeded). The start point is `cardAt` when it lies in a window, else the next window start. The tap may fall after the window end. The longest gap (Friday 18:00 to Saturday 10:00) is 16 h, well inside the 48 h approval time.
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
11. `cardKindOf`: `["ap:x","ar:x"]` → `approval`; `["as:s","rs:s"]` → `reminder_set`; `["rw:p:x","rw:c:x","rw:n:x"]` → `reject_reason`.

## Check

`bun test packages/core/src/sim/live/executive.test.ts`, then the Proof.

## Done when

Tests 1–11 pass; the Proof prints `PROOF_OK`.

## Out of scope

Reading the fake Telegram and the DB (stage 09).
