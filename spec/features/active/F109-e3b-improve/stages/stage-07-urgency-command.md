# F109 stage 07 — Urgency profile command

Part of [`../plan.md`](../plan.md). Decisions P7, D9. Needs stage 02.

## Step 1 — Service and API command

**Goal.** An owner can set or clear the urgency profile of one mailbox through one channel-neutral command (ADR 0023). E4-B (F110) builds its editor on this command.

**Interfaces (E4-B uses them; keep them).**

- Core (`packages/core/src/web/settings.ts`): `urgencyBodySchema = z.object({ profile: urgencyProfileSchema.nullable() })`; the settings view gets `urgencyProfile: UrgencyProfile | null`.
- Server (config module): `setUrgencyProfile(db, ctx, mailboxId, profile: UrgencyProfile | null, via)`.
- Route: `PUT /api/settings/:mailboxId/urgency`, owner only, body `urgencyBodySchema`, answer = the settings view.

**Decisions.**

- The shape is the existing `urgencyProfileSchema` (F097 D8: ≤ 20 topics with ≤ 10 keywords, ≤ 20 deadlines `YYYY-MM-DD`, label and keyword limits as in the schema). Do not change the schema; E2a's sim reads it.
- Storage `mailbox_settings.urgency_profile`. The write takes the settings row lock and sets `updated_at`, so a triage batch with an older settings version retries (triage rule 9).
- An empty profile (`{ topics: [], deadlines: [] }`) is stored as `null`.
- Past deadlines are allowed; the prompt filters them (stage 10).
- Audit row `settings.urgency_set` with `{ topics: <count>, deadlines: <count>, via }`; no labels or keywords in the audit row or in a log line.
- VIP people stay sender rules (P7); the command does not touch `sender_rules`.

**Test (integration).**

1. Owner `PUT` with 2 topics and 1 deadline → 200; `GET /api/settings/:id` shows the same profile; `updated_at` changed.
2. `{ profile: null }` → the column is null; an empty profile → null too.
3. A member who is not an owner → 403; a mailbox of another organization → 404; 21 topics → 400 with the schema error, no write.
4. Audit row holds counts and `via`, no label text.
5. The route-schema test of ADR 0023 knows the new route (it fails without the schema).

## Step 2 — CLI

**Goal.** `bun run mailbox:settings urgency --org-id <uuid> --mailbox-id <uuid> (--file <path.json> | --clear)` sets or clears the profile; `show` prints `urgency topics=<n> deadlines=<m>` (or `urgency none`).

**Decisions.** The CLI calls `setUrgencyProfile` with `via: "cli"`. A bad file (not JSON, schema error) prints the usage line and the Zod issue paths (no values) and exits 1. It prints counts, never labels.

**Test.** 6. Arg parser: `urgency` without `--file` or `--clear` → usage error; with both → usage error. 7. Integration: `--file` with a fixture of 1 topic → `show` prints `urgency topics=1 deadlines=0`; `--clear` → `urgency none`.

**Check.** The new tests, then the Proof.

**Done when.** Tests 1–7 pass; for each guard (owner check, `org_id` scope, schema) the worker removes it, sees its test fail, restores it; Proof `PROOF_OK`.

**Out of scope.** The panel editor (E4-B), the prompt (stages 08–11).
