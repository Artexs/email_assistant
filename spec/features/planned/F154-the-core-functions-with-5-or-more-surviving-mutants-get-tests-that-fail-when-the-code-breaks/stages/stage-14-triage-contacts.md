# F154 stage 14 — triage helpers, contacts, mail providers, send limits

Needs stage 01: `scripts/test-audit/mutation-gaps.ts` and the run lock in `mutation.sh`. May run next to 02–13, 15–17.

Part of [`../plan.md`](../plan.md). Method: plan.md § Stage method. Decisions P2, P3, D5–D10.

## Functions (audit counts at `4ce3f351`)

| File | Function | Count |
| --- | --- | --- |
| `triage/eval-case.ts` | `prioritize`, `byId` | 17, 5 |
| `triage/cost.ts` | `priceRowFor` | 9 |
| `triage/metrics.ts` | `simGoNoGo` | 9 |
| `triage/settings.ts` | `describeSettings` | 9 |
| `triage/payloads.ts` | `sendPayloadFor` | 5 |
| `triage/address.ts` | `splitAddress` | 7 |
| `contacts/address.ts` | `caseFormTable`, `addressCasedCodePoints` | 8, 6 |
| `contacts/suggestions.ts` | `byRank` | 5 |
| `mail/providers.ts` | `serversFor`, `presetForAddress` | 9, 5 |
| `send-limits.ts` | `windowUntil` (private; through `checkSendLimits`) | 5 |

Mutate globs: one per file above, for example `src/triage/eval-case.ts`.

`contacts/address.ts` changed after the audit run (a rename and new cases); measure its own before (plan D3).

## Cases (fixed values)

1. `splitAddress` (planner probe at `a5399ff1`, all held): `'"Jan Kowalski" <jan@firma.pl>'` → `{ name: "Jan Kowalski", address: "jan@firma.pl" }`; `"Jan <jan@firma.pl>"` → `{ name: "Jan", … }`; `"jan@firma.pl"` → `{ name: null, address: "jan@firma.pl" }`; `" <jan@firma.pl> "` → `{ name: null, … }`; `'"" <a@b.pl>'` → `{ name: null, address: "a@b.pl" }`.
2. `presetForAddress` (probe, all held): `jan@interia.pl` → `"interia"`; `jan@INTERIA.PL` → `"interia"`; `@interia.pl` → `"interia"`; `jan@gmail.com` → `"gmail"`; `jan` → `null`; `jan@nieznana.pl` → `null`.
3. `serversFor`: a preset only → the preset's exact server fields; a preset plus one overriding field → that field wins, the rest from the preset; no preset and all fields → the fields; no preset and a missing field → the error or default at `HEAD`.
4. `windowUntil` through `checkSendLimits`: cap 3, window one hour (`HOUR_MS`), three sends at 09:00, 09:10, 09:20, now 09:30 → blocked until 10:00 exactly; two sends → not blocked; sends given out of order → the same 10:00 (kills the sort and map mutants).
5. `prioritize`: one case per branch with the exact ordered ids; `byId`: two cases whose order depends only on id (`"a1"` before `"a2"`).
6. `priceRowFor`: a known model → its exact price row; an unknown model → the error or `null` at `HEAD`; a model name with a date suffix → the code's match at `HEAD`.
7. `simGoNoGo`: one case per verdict (go, no-go) with fixed counts at the precision bar and one case below it.
8. `describeSettings`: default settings and settings with every option set → exact line arrays.
9. `sendPayloadFor`: each action kind the two `if` lines check → the exact payload.
10. `caseFormTable` and `addressCasedCodePoints`: the last code point `0x10ffff` is in range (kills `<` vs `<=`); a code point with a case form (`"A"` → `"a"`) and one without (`"1"`) → exact table entries; the dotless `ı` and long `ſ` stay out.
11. `byRank`: two candidates with the same rank → ordered by key (`"a"` before `"b"`); different ranks → rank wins.

A comparator mutant that cannot change the order of distinct keys is `equivalent` (plan D5); write the reason.

## Done when

- `results/stage-14.md` meets D5 and D6 for every function in the table.
- Last step: `bun run check:job`.

## Out of scope

- Price values, presets, and send caps.
