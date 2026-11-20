# F154 stage 07 — trusted auth results, attachments, display names, DKIM

Needs stage 01: `scripts/test-audit/mutation-gaps.ts` and the run lock in `mutation.sh`. May run next to 02–06, 08–17.

Part of [`../plan.md`](../plan.md). Method: plan.md § Stage method. Decisions P2, P3, D5–D10.

## Functions (audit counts at `4ce3f351`)

| File | Function | Through | Count |
| --- | --- | --- | --- |
| `triage/suspicious.ts` | `trustedAuthResults` | itself, `assessSuspicious` | 14 |
| `triage/suspicious.ts` | `isRiskyAttachment`, `isDisplayNameSpoof`, `foldName`, `domainOfAddress` (private) | `assessSuspicious` | 7, 7, 6, 5 |
| `triage/dkim-pass.ts` | `trustedAlignedPassDomains`, `stripCommentsAndQuotes` (private) | `hasCoveredDkimPass` | 13, 9 |
| `triage/dkim-signature.ts` | `tagsOf` (private) | `dkimSignaturesOf` | 8 |

Mutate globs: `src/triage/suspicious.ts`, `src/triage/dkim-pass.ts`, `src/triage/dkim-signature.ts`. In `suspicious.ts`, count only the functions above (stage 06 owns the rest).

The `suspicious.ts` cases go into a new file `triage/suspicious-auth.test.ts` (plan D8). The DKIM cases go into the existing test files of those modules.

## Cases (fixed values)

`trustedAuthResults(value, ["mx.firma.pl"])`, exact return:
1. `null` → `null`; `"mx.firma.pl"` (no `;`) → `null`; `"; spf=pass"` (empty id) → `null`.
2. `"mx.firma.pl; spf=pass"` → `"; spf=pass"`; `"MX.Firma.PL; SPF=Pass"` → `"; spf=pass"` (folded).
3. Sub-domain: `"a.mx.firma.pl; dkim=pass"` → `"; dkim=pass"`; look-alike suffix `"evilmx.firma.pl; dkim=pass"` → `null`.
4. Trusted list folding: `trusted = [" MX.firma.pl. "]` accepts `"mx.firma.pl; x"`; `trusted = ["", " "]` accepts nothing.
5. An id followed by a version: `"mx.firma.pl 1; spf=pass"` → `"; spf=pass"`.

Auth-fail through `assessSuspicious` (trusted `mx.firma.pl`): `dmarc=fail` alone → the auth reason; `spf=fail` alone → no auth reason; `spf=fail` and `dkim=fail` → the auth reason; `dmarc=failed` → no auth reason (the `(?![a-z])` edge).

Attachments through `assessSuspicious`, `test.each` with the exact reason list:
6. Type `application/x-msdownload; name=a` → risky; type `APPLICATION/X-MSDOWNLOAD` → risky; name `faktura.PDF.EXE` with a safe type → risky; name `faktura.pdf` → not risky; name `null` with a safe type → not risky; a name with no dot → not risky. Use a type and an extension from the `RISKY_TYPES` and `RISKY_EXTENSIONS` sets at `HEAD`.

Display-name spoof through `assessSuspicious`, protected names `["Jan Kowalski"]`:
7. From name `"jan@firma.pl"` with From address `jan@firma.pl` → no spoof; From name `"jan@firma.pl."` with the same address → no spoof (trailing dot); From name `"jan@bank.pl"` with address `jan@firma.pl` → spoof.
8. From name `"Jan  KOWALSKI"` → spoof; `"Ján Kowalski"` → spoof (diacritic removed); protected `["Paweł Nowak"]` with From name `"Pawel Nowak"` → spoof (`ł` → `l`); protected single word `["Jan"]` with From name `"Jan"` → no spoof (needs two words); From name `null` or `"  "` → no spoof.

Reply-To domain through `assessSuspicious`:
9. From `jan@firma.pl`, Reply-To `jan@firma.pl` → no mismatch; Reply-To `x@inna.pl` → mismatch; a Reply-To with no `@` → the code's result at `HEAD` (domain `null`).

DKIM:
10. `hasCoveredDkimPass`: one case per surviving mutant cluster: a comment `(…)` and a quoted string in the results are stripped before matching; the pass domain must align with the From domain; an unterminated comment does not loop or throw.
11. `dkimSignaturesOf`: a tag without `=`, a tag with `=` at position 0, and spaces around tag names → the exact tag map at `HEAD`.

## Done when

- `results/stage-07.md` meets D5 and D6 for every function in the table.
- Last step: `bun run check:job`.

## Out of scope

- The look-alike and punycode functions (stage 06). Changes to the risky type or extension sets.
