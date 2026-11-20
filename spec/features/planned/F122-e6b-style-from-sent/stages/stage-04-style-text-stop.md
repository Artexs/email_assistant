# F122 stage 04 — Stop using `organizations.style_text` `[risky]`

Part of [`../plan.md`](../plan.md). Needs: nothing of this ticket (F115 `mailbox_profiles` exists). May run next to every stage but 05; never next to another migration in build. R1: the coordinator releases this stage before stage 05 builds.

The expand half of PD-079. The old organization signature moves into every mailbox that has no signature of its own, the column is emptied, and no code reads or writes it after this stage, also not the export and the DSR erase. The column stays until stage 05 drops it, so the code of this release runs on the schema of stage 05 (rollback and the swap window, review B1).

## Step 1 — Copy migration

- **Goal:** one dbmate file `db/migrations/YYYYMMDDHHMMSS_style_text_copy.sql`: for every mailbox whose organization has a non-empty `style_text` and whose profile has no signature, set the signature to the org text; insert a profile row (`org_id`, `mailbox_id`, signature, `updated_at` = now, `updated_by` null) where none exists; then set `style_text` to null in every organization. Down: empty (forward-only, PD-053; write the comment the other forward-only files use).
- **Decisions:** D13. A profile signature that is set stays as it is. The column has no DB length check (the route allowed ≤ 500), so the copy cuts to the profile limit (1,000 characters) to meet the profile CHECK. The update runs as one statement per case, so a second run changes nothing.
- **Test (integration, migration test pattern of the repo):**
  1. Org with `style_text` "Pozdrawiam, Zespół" and three mailboxes: one with signature "Anna", one with a profile row and a null signature, one with no row → "Anna", "Pozdrawiam, Zespół", "Pozdrawiam, Zespół" (new row).
  2. Org with `style_text` null → no row is made or changed.
  3. Run the statements twice → the same rows, the same `updated_at` of the first run.
  4. After the run every `organizations.style_text` is null; an org with text and no mailbox loses the text (`questions.md` 16).

## Step 2 — Code stops using the column

- **Goal:** remove every read and write of `style_text` / `styleText` outside the schema types and the migrations: the fallback chains (`profileFallbacks`, `resolveReplyStyle`, `buildOutgoingMessage`, the preview, the drafter job), the organization view and `PATCH /api/organization` (`organizationPatchSchema`, the tenancy service and repo writer), the read-only `SignatureCard` (the card goes; the style card is the one place of a signature), the web texts that only it uses, `docs/api/openapi.json`, and the fixtures of the tests.
- **Decisions:** D13, D14. New fallbacks: signature → owner display name; From name → owner name → address (unchanged). `GET /api/mailboxes/:id/profile` `fallbackSignature` = the owner name. `PATCH /api/organization` with `styleText` → 400 `validation` (strict schema). The audit kind `org.style_changed` stays a known kind, so the security log still reads old rows. The export map stops selecting the column and the DSR address map stops updating it: the column is classified as excluded with the reason "emptied in F122 stage 04, dropped in stage 05", in the form the privacy completeness tests accept (for example `byOrgExcluding`). `schema.ts` keeps it until stage 05.
- **Test:**
  1. Unit: `profileFallbacks` with no signature and owner "Wiktor Szalewski" → signature "Wiktor Szalewski".
  2. Unit: `buildOutgoingMessage` of a delegation with a null profile signature → the owner name line; with signature "Anna" → "Anna".
  3. Integration: `PATCH /api/organization` `{ styleText: "x" }` → 400; `{ timezone: "Europe/Warsaw" }` → 200.
  4. Integration: GET profile of a mailbox with no row → `fallbackSignature` = owner name.
  5. Integration: the organization export holds no `style_text` key while the column still exists; a DSR erase runs with no statement on the column.
  6. A check that must find nothing else: `rg -n "style_text|styleText" apps packages` finds only `schema.ts`, the privacy exclusion with its reason, the 400 test of case 3, the migration tests of this stage, and `reply-drafts-schema.test.ts` (F115 migration round trip; stage 05 decides it).
- **Check:** `bun run db:migrate`, then the Proof.
- **Done when:** the tests pass; capability pages `drafts-and-send.md`, `tenancy-and-plans.md`, `web-panel.md` and `reply-drafts.md` say the signature lives only in the mailbox profile and that the column is dropped next (stage 05); the Proof line is PASS.
- **Out of scope:** the drop (05).
