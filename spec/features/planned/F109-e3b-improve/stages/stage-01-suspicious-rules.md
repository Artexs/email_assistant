# F109 stage 01 — Suspicious-mail rules (core)

Part of [`../plan.md`](../plan.md). Decisions P1, D1, D2, D3.

## Step 1 — `assessSuspicious` and its helpers

**Goal.** One pure function gives the suspicious reasons of one mail, for triage (stage 03) and the sim (stage 05).

**Files.** New `packages/core/src/triage/suspicious.ts` and its test.

**Interfaces (stages 03–05 use them; keep the names).**

```ts
export const suspiciousReasons = ["auth_fail", "lookalike_domain", "display_name_spoof",
  "reply_to_mismatch", "link_mismatch", "risky_attachment"] as const;
export type SuspiciousReason = (typeof suspiciousReasons)[number];
export interface SuspiciousInput {
  fromAddress: string; fromName: string | null; replyTo: string[];
  authResults: string | null; trustedAuthservIds: string[];
  links: { host: string; textHost: string | null }[];
  attachments: { name: string | null; type: string }[];
  isList: boolean;            // List-Id or List-Unsubscribe
  senderKnown: boolean; knownDomains: string[]; protectedNames: string[]; // D4, from the caller
}
export function assessSuspicious(input: SuspiciousInput): SuspiciousReason[]; // list order, no duplicates
export function registrableDomain(host: string): string;
export const freeMailDomains: readonly string[];
```

**Decisions (rules).**

- Fold input first: lower case, NFKC, `xn--` labels decoded (a small RFC 3492 decoder in the module; no Node import), no trailing dot.
- `registrableDomain`: the last two labels, or three when the last two are a built-in two-level suffix (at least `com.pl net.pl org.pl edu.pl gov.pl info.pl biz.pl waw.pl co.uk org.uk ac.uk com.au co.jp com.br co.nz co.za`).
- `auth_fail` (any sender): `authResults` is set and its `authserv-id` (the first token before `;`, folded) equals a `trustedAuthservIds` entry or ends with `.` + an entry; and the header says `dmarc=fail`, or both `spf=fail` and `dkim=fail`. Anything else gives no reason.
- `risky_attachment` (any sender): an attachment whose last extension is in `exe scr bat cmd com pif js jse vbs vbe wsf hta ps1 msi jar lnk iso img docm xlsm pptm dotm xlam`, or whose type is one of `application/x-msdownload application/x-msdos-program application/x-sh application/java-archive application/vnd.ms-excel.sheet.macroenabled.12 application/vnd.ms-word.document.macroenabled.12`. A password-protected archive is not visible from name and type: no rule (stage 16 notes it).
- The next four rules need `senderKnown = false`:
  - `lookalike_domain`: the sender's registrable domain is not in `knownDomains`, and for one known domain either the skeletons are equal or the labels left of the suffix have Damerau–Levenshtein distance 1 and both are at least 5 characters. Skeleton: map Cyrillic and Greek letters that look Latin to Latin, `0→o`, `1→l`, `i→l`, `rn→m`, `vv→w`, and drop `-`. Rejected: the full UTS #39 table (size, unchecked library).
  - `display_name_spoof`: `fromName` holds an address (`x@y.z`) that differs from `fromAddress`; or the folded name (diacritics removed, single spaces) equals a folded `protectedNames` entry with at least two words.
  - `reply_to_mismatch`: `isList` is false and a `replyTo` address has another registrable domain than `fromAddress`.
  - `link_mismatch`: `isList` is false and a link has a `textHost` whose registrable domain differs from that of `host` (list mail with click-tracking links is exempt, review N18).
- `freeMailDomains`: at least `gmail.com googlemail.com outlook.com hotmail.com live.com yahoo.com icloud.com interia.pl interia.eu poczta.fm wp.pl o2.pl onet.pl op.pl gazeta.pl tlen.pl proton.me protonmail.com gmx.de gmx.net web.de`.

**Test (unit, fixed values).**

1. `billing@paliwa-fiota.test`, known `paliwa-flota.test`, unknown sender → `["lookalike_domain"]`.
2. Same input, `senderKnown: true` → `[]`.
3. `abc.test` vs known `abd.test` → `[]` (labels under 5 characters).
4. The `xn--` form of `pаypal.test` (Cyrillic `а`; the test gets it from `new URL("http://pаypal.test").hostname`, not from a typed string) vs known `paypal.test` → `lookalike_domain`; the decoder turns it back into `pаypal.test`.
5. Auth `mx.interia.pl; dmarc=fail header.from=x.test`, trusted `["interia.pl"]` → `auth_fail`; trusted `[]` → `[]`; `spf=fail dkim=pass` → `[]`; `spf=fail dkim=fail` → `auth_fail`.
6. `fromName: "Jan Kowalski <ceo@corp.test>"`, address `x@evil.test` → `display_name_spoof`; `fromName: "Jan Kowalski"`, protected `["Jan Kowalski"]` → spoof; protected `["Jan"]` → `[]`.
7. Reply-To `pay@other.test` from `a@shop.test`, `isList: false` → `reply_to_mismatch`; `isList: true` → `[]`.
8. Link `{ host: "evil.test", textHost: "www.bank.test" }` → `link_mismatch`; the same with `isList: true` → `[]`; `{ host: "news.shop.co.uk", textHost: "shop.co.uk" }` → `[]`.
9. Attachment `faktura.pdf.exe` → `risky_attachment` also with `senderKnown: true`; `umowa.docx` → `[]`.
10. `registrableDomain`: `a.b.example.com.pl` → `example.com.pl`; `mail.kordelan.test` → `kordelan.test`; `localhost` → `localhost`.
11. All six rules true → the six codes in list order.

**Check.** The new test file, then the Proof.

**Done when.** Tests 1–11 pass; the Proof of `plan.md` prints `PROOF_OK`.

**Out of scope.** DB reads, the known-sender list (stage 03), effects.
