FAIL 4a7c85425969829997d8c9dd15757b7a22b6c0e8

Reviewed commit `4a7c85425969829997d8c9dd15757b7a22b6c0e8`. `git rev-parse HEAD` returns this sha, and the tree is clean. The base is `5cc362807`, the F122 "plan landed" commit.

## Blocking

**B1. The quote cut misses the Polish Outlook reply header. Proven by reproduction.**
- Where: the header-block cut in `packages/core/src/replies/style-cut.ts` (`HEADER_FIELD`, `startsHeaderBlock`).
- What D4 asks: the stage file `stages/stage-01-stylist-core.md`, Step 1, says to cut at "a block of two or more header lines that starts with `From:`/`Od:` after a blank line or after a line of 10+ underscores or dashes (Outlook, OWA)".
- What the code does: `HEADER_FIELD` accepts `Wysłano:` but not `Wysłane:`. Polish Outlook (desktop and OWA) writes `Od: / Wysłane: / Do: / DW: / Temat:`. The `Wysłane:` label comes from my knowledge of the Polish Outlook client. No fixture in the repo shows it.
- Because of that, the block count stops at 1 and nothing is cut. Evidence: `cutQuotedReply("Ok.\n\nOd: Anna\nWysłane: wtorek\nDo: Jan\nTemat: x\n\nstare", { signature: null })` returns the input unchanged (log `probe-b1.log` in the job folder). In an earlier probe, the same block after a `________________________________` rule also stayed uncut.
- Effect: for a Polish manager on Outlook, the quoted third-party mail goes into the stylist prompt as "the manager's mail". That is the main client of the target users. D4 exists to prevent this.
- The worker's own test "Polish header block" uses `Wysłano`, so it does not catch this.
- Fix: accept `Wysłane` and `Wysłano` (for example `Wysłan[eo]`). Add a test.
- The one check that would prove the candidate wrong is the call above with `expect(...).toBe("Ok.")`. Today it fails.

## Unverified

- Lint, typecheck, unit tests and `check:job`: not run. The task says "run no suite, lint or typecheck". I have no worker `check:job` line to cite.
- The new test files: I did not run them. I read their assertions against the stage items.

## Notes

1. **Thunderbird Polish forward is not cut (plausible gap; the code behaviour is proven by an earlier probe).** The input `-------- Przekazana wiadomość --------` followed by `Temat:/Data:/Od:` stays in the sample, so the forwarded third-party text goes to the model.
   - `FORWARD_LINE` knows only `Forwarded message` and `Wiadomość przekazana`.
   - The header block must start with `From:`/`Od:`, but Thunderbird puts `Temat:` first.
   - This form is outside the D4 list, so it is not blocking. Adding `Przekazana wiadomość` is cheap.
   - Apple Mail `Begin forwarded message:` is cut by the header block below it. Only that one line stays.
2. **Own text is lost on false header matches (probe; low harm).**
   - `"On Monday we talk.\nAs Anna wrote:\nmore"` returns `""`, because it matches the two-line `On … / … wrote:` form.
   - `"Tak jak Pan napisał:\n…"` returns `""`, because `PL_NAPISAL_END` matches any line that ends in `napisał:`.
   - Both follow the D4 text. The cost is a lost sample, not a leak.
3. **Gaps in the name check (probe; spec-compliant).**
   - An all-caps name passes: `"Writes to KARIN often."` with `names:["karin"]` returns ok, because `CAPITALISED` needs a lower-case letter.
   - A 3-letter name in another case form passes: `"Greets Ewy warmly."` with `names:["ewa"]` returns ok. The stem rule covers only tokens of 4+ letters.
   - Mid-sentence capitalised common words become name tokens and can cause false `name` failures. Example: `names:["short"]` makes the GOOD text fail. This costs a retry, not a leak.
   - The owner reads the text before Save, which the interfaces file names as the known limit.
4. **Output schema and checks: correct (by reading).**
   - `stylistOutputSchema` is strict. It trims, requires at least 1 character, and allows at most 4,000 code points.
   - `checkStyleSuggestion` covers all 10 codes in the order of `STYLE_CHECK_CODES`.
   - It reuses `sensitiveFailures` with an empty allowed list.
   - It counts length in code points. An `unknown` language passes.
   - `checkReplyBody` keeps its behaviour after the extraction into `sensitiveFailures`. I checked this by reading only.
   - D7 also requires `checkProfileInput`. That is not in stage 01. Stage 02 must run it.
5. **Injection safety of the `stylist-v1` prompt: adequate (by reading).**
   - The system prompt states that the samples are data and never instructions. It also covers claimed authority, keeping the output format, and the never-list of D6.
   - The language line sits outside the data block.
   - `cleanSample` drops marker-like lines (any id, with spaces). Then `neutralize` strips every `<<<` and `>>>`, so a block cannot be closed from inside.
   - Plausible weak point: a sample line `---` looks like a sample separator to the model. This is harmless.
   - The nonce comes from the caller. Stage 02 must make it random for each call.
6. **Role table and config: complete (by reading).**
   - `stylist` is added to `llmRoles`, `llmRoleModels` (light, low), `llmRoleTable` and `uniformRoleTable`.
   - `.env.example` gets `LLM_STYLIST_TIMEOUT_MS` and `LLM_STYLIST_RPM`.
   - The `llm:check` test is updated.
   - `removedEnvKeys` excludes `stylist` with a hard-coded `role !== "stylist"`. This works, but the next new role must repeat the exclusion. A small design note.
7. **Doc drift (by reading).** `docs/capabilities/triage.md` rule 6 is not updated for the new role:
   - It still lists `light` as "(classifier, drafter, extractor)".
   - The list of effort levels omits `stylist low`.
   - It names the `LLM_<ROLE>_TIMEOUT_MS`/`_RPM` keys for "(judge, drafter, extractor)" only.
   - Rule 15 and `docs/architecture.md` were updated.
8. **Sample filters: match the interfaces file (by reading).** `buildStyleSamples` does the following:
   - It cuts each text and drops empty ones.
   - It keeps the input order.
   - It cuts each sample to 1,500 code points and stops at 60,000 in total.
   - It takes `names` only from the sources it used, with the signature already removed.

## Checks run

- `git rev-parse HEAD`: returned `4a7c85425…`, which matches the candidate.
- One earlier ad-hoc bun probe, outside the repo, then deleted. It printed results for 9 cut cases and 4 check cases (the results are quoted above).
- The B1 probe again, saved to `probe-b1.log`. Its output was the input text, unchanged.
- No test file, suite, lint or typecheck ran.

## Note check

- The HEAD match: proven. `git rev-parse HEAD` returned `4a7c85425969829997d8c9dd15757b7a22b6c0e8`.
- The stage items judged against the diff: proven by reading the diff (`git diff 5cc362807 HEAD -- packages/ apps/ .env.example`). One line per item follows:
  - Step 1.1, English `On … wrote:`: covered by a row in `style-cut.test.ts`, by reading.
  - Step 1.2, Polish `W dniu … pisze:`: covered by a row, by reading.
  - Step 1.3, `-----Original Message-----`: covered by a row, by reading.
  - Step 1.4, the `From:/Sent:/To:` block: covered by a row, by reading. The Polish Outlook form fails (B1, `probe-b1.log`).
  - Step 1.5, `>` lines: covered by a test, by reading.
  - Step 1.6, `-- ` signature mark: covered by a `test.each`, by reading.
  - Step 1.6b, Gmail forward and the underscore rule: covered by rows, by reading.
  - Step 1.7, inline signature: covered by tests, by reading.
  - Step 1.8, sample counts 2, 1,500 and 40: covered in `style-samples.test.ts`, by reading.
  - Step 1.9, name tokens: covered in `style-samples.test.ts`, by reading.
  - Step 2.1, the plain text passes: covered in `style-check.test.ts`, by reading.
  - Step 2.2, `name` with the Karin and Marku cases: covered, by reading.
  - Step 2.3, phone, link, address and account number: covered by a `test.each`, by reading.
  - Step 2.4, `quote_line`: covered, by reading.
  - Step 2.5, `copied_text` at 8 and 7 words: covered, by reading.
  - Step 2.6, `too_long` and `control_chars`: covered, by reading.
  - Step 2.7, `language`: covered, by reading.
  - Step 2.8, schema refusals: covered, by reading.
  - Step 3.1, registry: covered in `stylist-v1.test.ts`, by reading.
  - Step 3.2, marker appears once: covered, by reading.
  - Step 3.3, light tier for each provider: covered in `config-roles.test.ts`, by reading.
  - None of these tests was run. This is not proven by execution, as the task forbids test runs.
- The task focus areas, each with a verdict: proven. This message, Notes 1–8 and B1.
- The one disproving check named: proven. See B1 and `probe-b1.log`.
- Easy-to-miss rule "Run no suite, lint or typecheck": followed. Only two ad-hoc probe scripts ran. No `bun test`, lint or typecheck command ran in this session.
- Reminder "Tests run once per job / no test:unit etc.": followed. No suite ran.
- Reminder "a product-code job ends with `check:job`": not applicable. This is a review job with no commit.
- Reminder "a review runs no suite, lint or typecheck": followed, as above.
- Reminder "never delete `node_modules/.cache/`": followed. No delete ran under `node_modules`.

Decisions for the owner: none
