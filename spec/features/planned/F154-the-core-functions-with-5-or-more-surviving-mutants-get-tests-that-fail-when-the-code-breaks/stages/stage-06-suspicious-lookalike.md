# F154 stage 06 — look-alike domains and the punycode decoder

Needs stage 01: `scripts/test-audit/mutation-gaps.ts` and the run lock in `mutation.sh`. May run next to 02–05, 07–17 (stage 07 also covers `triage/suspicious.ts` but writes its own test file, plan D8).

Part of [`../plan.md`](../plan.md). Method: plan.md § Stage method. Decisions P2, P3, D5–D10.

## Functions (audit counts at `4ce3f351`), all in `triage/suspicious.ts`

| Function | Through | Count |
| --- | --- | --- |
| `isOneEditApart` (private) | `isLookalike` | 29 (top 10) |
| `punycodeDecode` (private) | `registrableDomain` (an `xn--` label) | 23 |
| `adapt`, `digitValue` (private) | `registrableDomain` | 18, 16 |
| `skeleton` (private) | `isLookalike` | 8 |
| `isLookalike` | itself | 6 |

Mutate glob: `src/triage/suspicious.ts`. Count only the functions above in this stage's results; stage 07 owns the others in the same file.

Cases go into `triage/suspicious.test.ts`.

## Cases (fixed values)

`isLookalike(sender, ["amazon.com"])`, `test.each` with the exact boolean:
1. Substitution `amazom.com` → `true`.
2. Adjacent swap in the middle `amzaon.com` → `true`; at the end `amazno.com` → `true`.
3. Insertion `amazoon.com` → `true`; deletion `amazn.com` → `true`.
4. Two substitutions `anazom.com` → `false`.
5. Length difference 2 `amazonnn.com` → `false`.
6. Same label, other TLD `amazon.net` → `false` (kills the `a === b` mutants).
7. Sender on the known list `amazon.com` → `false`.
8. Short labels: `isLookalike("abcf.com", ["abcd.com"])` → `false` (4 letters); `isLookalike("abcdf.com", ["abcde.com"])` → `true` (5 letters, the `MIN_LABEL_LENGTH` edge).
9. Skeleton: `rnicrosoft.com` against `microsoft.com` → `true` (`rn` → `m`); `wvvw`-style `vv` → `w`: `vvikipedia.org` against `wikipedia.org` → `true`; a hyphen is dropped: `pay-pal.com` against `paypal.com` → `true`; `i` maps to `l`: `paypai.com` against `paypal.com` → `true`.
10. Targets only: `isLookalike("amazom.com", [], ["amazon.com"])` → `true`; `isLookalike("amazon.com", [], ["amazon.com"])` → `false` (a domain is never compared with itself).

Punycode (`registrableDomain` of a host with an `xn--` label; exact output):
11. `xn--bcher-kva.example` → `bücher.example`.
12. `xn--mnchen-3ya.de` → `münchen.de`.
13. A label with many non-ASCII code points (bias adaptation over several rounds): `xn--fiqs8s.example` → `中国.example`; `xn--80ak6aa92e.com` → `аррӏе.com`.
14. Upper-case digits in the encoded part decode the same as lower case: `XN--BCHER-KVA.example` → `bücher.example`.
15. Invalid input keeps the label: a character outside the base-36 digits `xn--bcher-kv!.example` → unchanged; an overflow `xn--99999999999999.example` → unchanged.

The planner ran cases 1–15 against the code at `a5399ff1` (probe, 2026-11-20): every value above held. Note: `xn--a.example` decodes to U+0080 plus `.example`; it is not a refusal, so do not use it as one.

## Done when

- `results/stage-06.md` meets D5 and D6 for every function in the table.
- Last step: `bun run check:job`.

## Out of scope

- `assessSuspicious` reasons other than the look-alike one. Changes to `CONFUSABLES`.
