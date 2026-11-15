# F109 stage 01 — Suspicious-mail rules (core)

Part of [`../plan.md`](../plan.md). Decisions P1, D1, D2, D3.

## Step 1 — `assessSuspicious` and its helpers

**Goal.** One pure function decides the suspicious reasons of one mail. Stages 03 (triage) and 05 (sim) call it with the same input shape.

**Files.** New `packages/core/src/triage/suspicious.ts` and its test. Export it from the core index the way `rules.ts` is exported.

**Interfaces (used by stages 03, 04, 05; keep the names).**

```ts
export const suspiciousReasons = ["auth_fail", "lookalike_domain", "display_name_spoof",
  "reply_to_mismatch", "link_mismatch", "risky_attachment"] as const;
export type SuspiciousReason = (typeof suspiciousReasons)[number];
export interface SuspiciousInput {
  fromAddress: string; fromName: string | null; replyTo: string[];
  authResults: string | null; trustedAuthservIds: string[];
  links: { host: string; textHost: string | null }[];
  attachments: { name: string | null; type: string }[];
  isList: boolean;            // List-Id or List-Unsubscribe present
  senderKnown: boolean;       // D4, decided by the caller
  knownDomains: string[];     // registrable domains the user knows (D4)
  protectedNames: string[];   // delegate and VIP display names (D4)
}
export function assessSuspicious(input: SuspiciousInput): SuspiciousReason[]; // order of suspiciousReasons, no duplicates
export function registrableDomain(host: string): string;
```

**Decisions (rules).**

- Input text is folded first: lower case, NFKC, `xn--` labels decoded (a small RFC 3492 decoder in the same module; no Node import, core stays pure), trailing dot removed.
- `registrableDomain`: the last two labels; the last three when the last two are in a built-in list of two-level public suffixes (at least: `com.pl net.pl org.pl edu.pl gov.pl info.pl biz.pl waw.pl co.uk org.uk ac.uk com.au co.jp com.br com.tr co.nz co.za`). A host with one label returns itself.
- `auth_fail` (any sender): `authResults` is set and its `authserv-id` (the first token before `;`, folded) equals a `trustedAuthservIds` entry or ends with `.` + an entry; and the header says `dmarc=fail`, or both `spf=fail` and `dkim=fail`. Anything else (missing, untrusted, `softfail`, `none`, a parse problem) gives no reason.
- `risky_attachment` (any sender): an attachment whose last extension is in `exe scr bat cmd com pif js jse vbs vbe wsf hta ps1 msi jar lnk iso img docm xlsm pptm dotm xlam`, or whose type is one of `application/x-msdownload application/x-msdos-program application/x-sh application/java-archive application/vnd.ms-excel.sheet.macroenabled.12 application/vnd.ms-word.document.macroenabled.12`. A password-protected archive cannot be seen from name and type: no rule for it (noted in stage 16).
- The next four rules need `senderKnown = false`:
  - `lookalike_domain`: the sender's registrable domain is not in `knownDomains`, and for one known domain either the skeletons are equal or the labels left of the suffix have Damerau–Levenshtein distance 1 and both are at least 5 characters. Skeleton: map Cyrillic and Greek letters that look Latin to Latin, `0→o`, `1→l`, `i→l`, `rn→m`, `vv→w`, and drop `-`. Rejected: the full UTS #39 table (size; the library's license and upkeep are not checked).
  - `display_name_spoof`: `fromName` holds an address (`x@y.z`) that differs from `fromAddress`; or the folded name (diacritics removed, single spaces) equals a folded `protectedNames` entry with at least two words.
  - `reply_to_mismatch`: `isList` is false and a `replyTo` address has another registrable domain than `fromAddress`.
  - `link_mismatch`: a link with `textHost` whose registrable domain differs from the registrable domain of `host`.

**Test (unit, fixed values).**

1. `billing@paliwa-fiota.test`, known `paliwa-flota.test`, unknown sender → `["lookalike_domain"]`.
2. Same input, `senderKnown: true` → `[]`.
3. `abc.test` vs known `abd.test` → `[]` (labels under 5 characters).
4. The `xn--` form of `pаypal.test` (Cyrillic `а`; the test gets it from `new URL("http://pаypal.test").hostname`, not from a typed string) vs known `paypal.test` → `lookalike_domain`; the decoder turns it back into `pаypal.test`.
5. Auth `mx.interia.pl; dmarc=fail header.from=x.test`, trusted `["interia.pl"]` → `auth_fail`; trusted `[]` → `[]`; `spf=fail dkim=pass` → `[]`; `spf=fail dkim=fail` → `auth_fail`.
6. `fromName: "Jan Kowalski <ceo@corp.test>"`, address `x@evil.test` → `display_name_spoof`; `fromName: "Jan Kowalski"`, protected `["Jan Kowalski"]` → spoof; protected `["Jan"]` → `[]`.
7. Reply-To `pay@other.test` from `a@shop.test`, `isList: false` → `reply_to_mismatch`; `isList: true` → `[]`.
8. Link `{ host: "evil.test", textHost: "www.bank.test" }` → `link_mismatch`; `{ host: "news.shop.co.uk", textHost: "shop.co.uk" }` → `[]`.
9. Attachment `faktura.pdf.exe` → `risky_attachment` also with `senderKnown: true`; `umowa.docx` → `[]`.
10. `registrableDomain`: `a.b.example.com.pl` → `example.com.pl`; `mail.kordelan.test` → `kordelan.test`; `localhost` → `localhost`.
11. All six rules true at once → the six codes in the order of `suspiciousReasons`.

**Check.** `bun test packages/core/src/triage/suspicious.test.ts`, then the Proof.

**Done when.** Tests 1–11 pass; the Proof of `plan.md` prints `PROOF_OK`.

**Out of scope.** Reading the DB, the known-sender list (stage 03), any effect.
