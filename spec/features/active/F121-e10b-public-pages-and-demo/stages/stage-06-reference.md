# F121 stage 06 — API and autonomy-evidence reference

Needs stage 01: `OWNER_REVIEW_PENDING` holding `reference/api` and `reference/autonomy-evidence`. Needs stage 02: the private-network claim id in `publicClaims` and its `#claim-<id>` anchor on `/security/`. May run next to 03, 04, 05.

Part of [`../plan.md`](../plan.md). Decisions P6, P7, D4. Review before the land (flagged routes, Q4).

Carry-over reads: `apps/server/src/platform/openapi.ts`, `apps/server/src/openapi-routes.test.ts` (how the app is built with fakes), `docs/capabilities/web-panel.md` rule 6, ADR 0023, `apps/docs/src/in-place.ts` (read-in-place pattern), `apps/docs/src/reference.test.ts`, `docs/capabilities/trust.md`, ADR 0028, `notes/2026-11-18-f110-s25-docs.md`, `apps/docs/src/flagged-text.ts`.

## Step 1 — The committed OpenAPI file

**Goal.** The docs site reads the API from a file that cannot drift from the app.

**Files.** New `apps/server/src/scripts/api-spec.ts` (+ test); `package.json` script `api:spec`; new `docs/api/openapi.json`.

**Decisions.**
- `buildPublicSpec()` builds the app as the route test does (fakes, no DB, no env file) and returns `openApiSpec`. Move the shared fake setup into one helper that both the route test and the script use; do not copy it.
- Output is stable: 2-space JSON, a newline at the end. No server URL, no host, no version beyond `"0"`.
- The hidden routes stay hidden (operator, auth, callback, the file itself).

**Test.**
1. `bun run api:spec --check` exits 0 at HEAD.
2. Drift test (unit): the committed file equals `buildPublicSpec()` output.
3. The file holds no path starting `/api/operator` or `/api/auth`.
4. Two builds give the same bytes.

Mutation: add a fake route with an `apiDoc` in the test app → test 2 fails; or edit one summary in the file → test 2 fails.

## Step 2 — Reference pages

**Goal.** A developer and a buyer read the API and the evidence rules.

**Files.** New `apps/docs/src/content/docs/reference/api.mdx` with a component that renders the file (method, path, summary, tag, auth: session or public, request schema, and every answer status with its schema name: a route can have two success answers, `apiDoc` `alsoOk`); new `reference/autonomy-evidence.mdx`; sidebar entries.

**Decisions.**
- API page: grouped by tag, sorted by path; intro: session cookie auth; a link to the security page claim about the private network (no own statement of reachability: claims live only in `publicClaims`, review 1 N12); "Some routes answer only while an operator turns a feature on." (Q4) Schema bodies are shown collapsed (`<details>`), no script.
- Evidence page (P6): only what no default-off flag gates. Read `trust.md` and the flags: list the facts that hold with every flag off (for example the go/no-go bar per category and where the numbers come from, the grant and re-gate rule that F110 noted as unflagged). Numbers come from code constants through an import, not typed by hand. If fewer than 3 unflagged facts exist, write no evidence page and say so in the final message (the coordinator decides).
- Both pages English only; front matter `capabilities` set.

**Test.**
5. `reference.test.ts` (extend): the API page lists every `operationId` of the file once; for an operation with two success statuses (an `alsoOk` route in the file), both statuses show.
8. The built API page holds no `gemini` (case-insensitive).
6. Each number on the evidence page equals its constant (test reads the rendered text or the component data).
7. `flagged-text.test.ts` passes.

**Check.** `bun test apps/server/src/scripts apps/docs/src`, `bun run api:spec --check`, `bun run docs:build`.

**Done when.** Tests 1–8 pass; Proof prints `PROOF_OK`.

**Out of scope.** Generating a client; changing any route or `apiDoc`; a CI step beyond the unit drift test (the test runs in `test:unit`).
