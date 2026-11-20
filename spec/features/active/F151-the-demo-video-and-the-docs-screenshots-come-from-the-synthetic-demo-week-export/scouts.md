# F151 scouts

Four scouts at base `e8f6f2b1` (claude-sonnet-5-5, medium). Each packet is copied whole from the job log. A packet is a lead, not a fact; the plan's Facts checked lists what the planner read again.

## Scout 1

Job: `2026-11-20-f151-scout-1-e04169d6`

Question:

> How does 'bun run demo:record' work end to end: how it picks its seed (--seed, DEMO_SEED_FILE, shotSource), how it loads the seed into the demo DB (DEMO_DATABASE_URL, setupDemoOrg), which servers and env it starts (TRIAGE_LLM_SCOPE, LLM provider config, fake Telegram), where it logs demo_source, how DEMO_STEPS live flags and en/pl captions are defined and checked (cue count, duration 100-130 s), and what exactly stops steps 2 (shadow days), 3 (report / history check) and 5 (urgent mail + Telegram notice) from running live. Context: spec/features/planned/F151-the-demo-video-and-the-docs-screenshots-come-from-the-synthetic-demo-week-export/ticket.md and spec/features/done/2026-11/F121-e10b-public-pages-and-demo/ (stages 07, 09, 10, stage-09-question.md). Answer for the code at HEAD.

Packet:

````text
Packet: How `bun run demo:record` works end to end, and what blocks live steps 2, 3 and 5.
Base: e8f6f2b1
Verified: read of `apps/web/e2e/demo/record.spec.ts` -> line 46: `if (shotSource().kind !== "e2e") throw new Error("demo_source_recording_not_built");`. I ran no command that reaches the recording.
Unknowns:
- The default seed file `apps/web/e2e/demo/demo-seed.json` does not exist (`ls` -> "No such file"). `~/.local/share/email-assistant/demo/` does not exist either. A demo-seed run was never executed here.
- I did not check that `setupDemoOrg` works with `TRIAGE_LLM_SCOPE=synthetic` or a real LLM. No such server env exists in the code.

1. `apps/web/e2e/demo/record.ts:49-135` (flow) — observed.
   - `package.json:34` runs `bun apps/web/e2e/demo/record.ts`.
   - Args: `parseRecordArgs` accepts `--seed` and `--out` (`lib/demo/record-args.ts:167`). `preflightProblem` (line 203) checks, in order: ffmpeg, the seed file exists, `DEMO_DATABASE_URL` and `DEMO_MIGRATOR_DATABASE_URL`, and `demoDbProblem`. The DB name must end in `_demo` and must differ from `DATABASE_URL`, `MIGRATOR_DATABASE_URL`, `E2E_DATABASE_URL` and `E2E_MIGRATOR_DATABASE_URL`.
   - `record.ts:56` needs `apps/web/dist/404.html`.
   - Seed pick (`record.ts:59-73`): `shotSource({...process.env, DEMO_SEED_FILE: --seed})`.
     - `lib/shot-source.ts:12-23`: `DEMO_SEED_FILE` set → that file, and a missing file throws `demo_seed_missing`, with no fallback.
     - Not set → `apps/web/e2e/demo/demo-seed.json` if it exists (`:6`), else `{kind: "e2e"}`.
     - For `kind=demo`, `record.ts:72` passes `DEMO_SEED_FILE` to the child env.
   - Then `resetDemoDb` drops every object in the demo DB (`demo/db-reset.ts`), and `bun run db:migrate` runs with `MIGRATOR_DATABASE_URL=migratorUrl` (`record.ts:76-78`).
   - Then `bunx playwright test -c apps/web/e2e/demo/demo.config.ts` (`record.ts:80`).
   - Then it reads `cues.json`, and `demo_cues_mismatch` fires if the cue step ids differ from `DEMO_STEPS` ids (`:84`). It shifts cue times by the first cue's `startMs`, writes `demo.{en,pl}.vtt`, and runs ffmpeg (`:88-103`). `ffprobe` gives the duration (`:104`). It prints duration, size, sha256 of the MP4 and both VTT files, and `not_live <ids>` (`:119-129`).
   - Exit 1 comes from `videoProblem`: over 15 MB, or length outside 100–130 s (`record-args.ts:156-157,214-220`).

2. `apps/web/e2e/demo/demo.config.ts:229-265` (DB, servers, env) — observed.
   - It sets `E2E_DATABASE_URL` and `E2E_MIGRATOR_DATABASE_URL` to `DEMO_DATABASE_URL` and `DEMO_MIGRATOR_DATABASE_URL`, after `demoDbProblem` (`:234-242`). `DEMO_DB_CHECKED` makes the check run once.
   - `e2eEnv()` (`e2e/env.ts:60-100`) gives the server env: `TRIAGE_LLM_SCOPE: "off"` (`:83`), `ACTIONS_SCOPE: "synthetic"`, `SEND_SCOPE: "self"`, `...E2E_LLM_PIN`, `TELEGRAM_BOT_TOKEN: FAKE_TOKEN`, `TELEGRAM_API_ROOT: E2E_TELEGRAM_URL` (`:94-95`), `MAIL_ALLOW_LOCAL_HOSTS=true`, `AUTH_PWNED_CHECK=off`.
   - There is no LLM provider key and no model stub in this env.
   - `e2eWebServers(env)` (`servers.ts:7-31`) starts two servers: the fake Telegram (`tools/fake-telegram/src/cli.ts serve --port`) and `bun run db:migrate && bun apps/server/src/main.ts` with that env.
   - Playwright config: `workers: 1`, `globalSetup: ./global-setup.ts`.

3. `apps/web/e2e/demo/global-setup.ts:156-178` (seed load, `demo_source`) — observed.
   - `shotSource()` is read again here, and the run logs `demo_source <kind>` (`:159`) to the Playwright console.
   - `record.ts:132` prints `demo_source e2e: not for upload` only for the e2e kind.
   - `kind=e2e`: the e2e `globalSetup()` seeds the e2e orgs.
   - `kind=demo`: `bun apps/server/src/scripts/demo-org-setup.ts --seed <file> --out apps/web/e2e/.demo-owner.json`, then `org-flag.ts --org-id <id> --flag <f> --on` for `trust_ladder`, `approvals_page`, `delegation_pages` (`:152,171-177`).
   - `demo-org-setup.ts:60-97` (`setupDemoOrg`): `readSeedFile`, `importDemo(replace: true, ownerEmail demo-owner@demo.test, sendScope = SEND_SCOPE ?? "off")`. It then sets the owner password through the auth reset path with `TERMS_VERSION`. Its DB guard `seedTargetOk` accepts `*_e2e` or `*_demo` names (`e2e-seed/args-seed-target.ts:14`).

4. `apps/web/e2e/demo/record.spec.ts:44-247` — the recording does not support a demo seed yet — observed.
   - Line 46 throws `demo_source_recording_not_built` when `shotSource().kind !== "e2e"`.
   - `kind=demo` passes setup but dies at the first test line. The spec reads `readSeed()` (the e2e seed) for `seed.owner`, `trustOrgs`, `approvalsOrgs` and `delegationsOrgs` (`:48-55`). A demo seed has none of these.
   - The command's own `--seed` path therefore cannot produce a video yet.

5. `apps/web/e2e/lib/demo/steps.ts:43-116`, checks, and the blockers — observed.
   - `DEMO_STEPS` has 8 steps. Each has `id`, `seconds`, `caption {en, pl}` and `live`. Seconds: connect 14, shadow 12, report 18, recommended 14, urgent 16, approval 16, delegation 14, undo 12. Total 116.
   - Live: connect, recommended, approval, delegation, undo. Not live: shadow, report, urgent.
   - Checks:
     - `steps.test.ts:57-70`: length is 8, ids are unique, planned total is 105–125 s, captions are 1–2 lines in en and pl, and a not-live caption matches `/^Day \d+:/` (pl `/^Dzień \d+:/`).
     - The cue count is checked at `record.ts:84` and `record.spec.ts:246`.
     - `toVtt` throws on an unknown step, a bad time or an empty cue (`steps.ts:135-145`).
     - The real 100–130 s limit is `videoProblem`, measured by `ffprobe` on the encoded MP4.
     - `step()` pads each step to its planned `seconds` (`record.spec.ts:96-111`) and scans page text with `publicContentScan` (`:104`).
   - Why steps 2, 3 and 5 are not live:
     - Step 2 (`shadow`, `record.spec.ts:139-146`): days do not pass in a recording. It only shows a seeded shadow-mode mailbox of the trust org.
     - Step 3 (`report`, `:148-154`): a real history check needs the history job. That job follows `TRIAGE_LLM_SCOPE`, which is `off` (`env.ts:83`), so it never claims the row. The page shows a seeded `reportMailboxes.done` row.
     - Step 5 (`urgent`, `:168-193`): with the model off no mail is triaged, so no `urgent` row exists and `detectUrgent` (`modules/channels/notices/urgent.ts`) queues nothing. A VIP rule changes only the classifier input.
       - The spec posts a notice itself: `urgentNotice("en")` from `lib/demo/notice.ts` goes to the fake Telegram `sendMessage`. The chat `DEMO_CHAT_ID 9_200_001` is linked to no org.
       - It views `${E2E_TELEGRAM_URL}/_fake/view?chat=…`.
   - The coordinator chose option 1 in `stage-09-question.md`. The limit is 3 not-live steps for the e2e-seed video. F151 must make steps 2, 3 and 5 live on the C1 seed, or say why not.
   - Option 2 in that file, not built: `TRIAGE_LLM_SCOPE=synthetic` plus a loopback OpenAI-compatible stub through `OPENAI_BASE_URL`.

Checks: `apps/web/e2e/lib/demo/steps.test.ts` covers step count, ids, planned total and captions. `record-args` and `db-guard` have their own tests (not run). It misses the spec flow, the demo-seed path, the live-step claims and the real video length. No existing check reaches `demo_source demo`.
````

## Scout 2

Job: `2026-11-20-f151-scout-2-58537e1a`

Question:

> What does the lab demo week export contain and how is it imported: 'bun run lab demo-reset' and 'bun run lab demo-export --day 5' (format, schema version, which tables/rows: shadow days, history checks, report rows, triage rows, notices, Telegram links), the importer that reads it (demo import, paused mailbox), size limits, and whether an import into a fresh DB gives an org on shadow day N with a ready 'what I would have done' report. Also: does any note or file record that the C1 export ran (notes/, docs/known-alerts.md, the D6 path ~/.local/share/email-assistant/demo/demo-seed-day5.json - stat only, do not print its content)? Context: spec/features/planned/F151-the-demo-video-and-the-docs-screenshots-come-from-the-synthetic-demo-week-export/ticket.md. Answer for the code at HEAD.

Packet:

````text
Packet: What the lab demo week export holds, how it is imported, and whether the C1 export ran
Base: e8f6f2b1
Verified: `stat ~/.local/share/email-assistant/demo/demo-seed-day5.json` -> `stat: cannot statx '/home/artek/.local/share/email-assistant/demo/demo-seed-day5.json': No such file or directory`
Unknowns:
- Whether an imported org shows a ready "what I would have done" report. I ran no import and no UI. I found no `shadow`, `report` or `history_checks` string in `demo-seed/*.ts`. Whether the report page rebuilds from the triage and action rows is guessed.
- Whether the export can differ in size: no size limit exists in code (see 4). The 5 MB limit is a coordinator rule only.

1. **Export.** Observed in `apps/server/src/modules/lab/demo-seed/types.ts`, `export.ts` and `format.ts`.
   - Format string is `ea-demo-seed/1`. The JSON header has `format`, `scenario`, `runId`, `day` (integer 1 to 7), `exportedAt` and `tables`.
   - `serializeDemoSeed` writes one row per line, sorted by table and id, so two exports of the same rows give the same bytes. The file mode is 0600. An existing file gives `out_exists`.
   - Tables, in `DEMO_TABLES` order: `organizations`, `mailboxes`, `mailbox_settings`, `sender_rules`, `delegates`, `emails`, `email_headers`, `triage_results`, `triage_feedback`, `actions`, `delegations`, `outbox`, `audit_log`.
   - Columns are the `EXPORT_MAP` columns of the privacy module. Users, memberships, credentials, sessions and Telegram links are not exported.
   - Rows created at or after 00:00 Warsaw after run day N are cut. Rows that point at a cut row are dropped too.
   - Rows with a `digest_id`, `loop_id` or `push_subscription_id` are dropped.
   - The export refuses a non-demo run, a day out of range, a wrong org name, a non-`.test` address and a non-loopback host.
   - `demo-export` reads the newest demo run in `orgs.json`. `demo-reset [--date] [--yes]` rebuilds the demo org and starts a week run with shadow on days 1 to 3 and assist from day 4 (`docs/capabilities/live-lab.md:93`).

2. **Missing from the export.** Observed in `tables.ts`. There is no table for shadow days, `history_checks` / `history_check_items`, `digests`, `open_loops` or Telegram links.
   - Shadow days exist only as the `mailbox_settings.mode` column. A day 5 export is therefore already in `assist` mode, not shadow.
   - The ticket assumes a seeded history check ("the history check is a seeded row", `live-lab.md:106`). The export does not carry that row.

3. **Import.** Observed in `import.ts` and `transform.ts`. `demo-import --file <f> --email <addr> [--replace]` builds a new org.
   - The org is named `Kordelan demo (import)` and every id is new. The owner is the `--email` user, created if missing.
   - Mailboxes are `paused` with the placeholder secret `demo-import-no-secret`.
   - Pending and processing emails become `skipped` with reason `demo_import`. Open actions become `expired` with `demo_import`. Outbox rows other than `sent` and `failed` are dropped.
   - The import refuses `SEND_SCOPE=all`, a non-test address or host, an org id that already exists and an existing import without `--replace`.
   - The whole insert is one transaction.

4. **Size limits.** I found none in the code (guessed from a grep of `demo-seed/*.ts` for size terms). The only limit is the rule "a file is committed only when it is under 5 MB" (`live-lab.md:175`; `notes/2026-11-20-f121-close-out.md:13`). It applies at commit time.

5. **C1 record.**
   - The D6 file and its folder `~/.local/share/email-assistant/demo` do not exist at this HEAD (observed).
   - `notes/` and `docs/known-alerts.md` hold no record that the export ran. The grep hits are plans only: `notes/2026-11-20-replan-parallel.md` says C1 waits for the F113 day run to end around 22:00 UTC, and `notes/2026-11-20-f121-close-out.md:13` says "Only if the C1 export is under 5 MB".
   - I did not read the file. It does not exist.

Checks: `apps/server/src/modules/lab/demo-seed/demo-seed.test.ts` and `apps/server/test/integration/lab-demo-seed.test.ts` cover export, import and the spec against `information_schema` (guessed from the file names; I did not run them). They miss an import into a fresh DB followed by a check of shadow day or report content.
````

## Scout 3

Job: `2026-11-20-f151-scout-3-3be61e4b`

Question:

> How do the docs screenshots get made and checked: 'bun run docs:shots' (Playwright spec, shotSource and DEMO_SEED_FILE default apps/web/e2e/demo/demo-seed.json), which pages and image files it writes, the image-path check, the flagged-text rule, the docs publication hold (OWNER_REVIEW_PENDING) and how the docs deploy downloads the demo video (DEMO_VIDEO_SHA256, release demo-video). What must change so shots come from a C1 demo seed file outside git, and what blocks committing shots when the seed itself is not in git (owner gate G2)? Context: spec/features/planned/F151-the-demo-video-and-the-docs-screenshots-come-from-the-synthetic-demo-week-export/ticket.md and spec/features/done/2026-11/F121-e10b-public-pages-and-demo/ (stages 07, 11, 12). Answer for the code at HEAD.

Packet:

````text
Packet: How docs shots are made and checked, what must change for a C1 demo seed outside git, and what G2 blocks.
Base: e8f6f2b1
Verified: `cat apps/web/e2e/lib/shot-source.ts` -> `return exists(DEFAULT_DEMO_SEED_FILE) ? { kind: "demo", file: DEFAULT_DEMO_SEED_FILE } : { kind: "e2e" };`. I ran no shot run, build or test.
Unknowns:
- The C1 file is absent: `ls ~/.local/share/email-assistant/demo/` -> `No such file or directory`. I could not check whether the demo path works with a real C1 file. Only its tests at HEAD exist.
- I did not read `demo-org-setup.ts` or `importDemo`. Whether a real C1 export passes the `non_test_address` guard is guessed.
- I did not read the F121 stage 12 text beyond its needs and file lines. The G2 text comes from `notes/2026-11-20-f121-close-out.md:13`.

1. `apps/web/e2e/lib/shot-source.ts:shotSource` — the demo source is already built. `DEMO_SEED_FILE` set but missing throws `demo_seed_missing`. Unset: it uses the default `apps/web/e2e/demo/demo-seed.json` if present, else the e2e seed. So a C1 file outside git works today: `DEMO_SEED_FILE=~/.local/share/email-assistant/demo/demo-seed-day5.json flock /tmp/email-assistant-shared-tests.lock bun run docs:shots`. — observed
2. Shot run (`package.json:33` → `apps/web/e2e/docs-shots.config.ts` → `docs-shots/global-setup.ts` and `shots.spec.ts`):
   - Setup logs `shots_source demo|e2e` and empties `*.png` in `SHOTS_DIR`. For demo it runs `bun apps/server/src/scripts/demo-org-setup.ts --seed <file> --out DEMO_OWNER_FILE` (git-ignored `apps/web/e2e/.demo-owner.json`). For e2e it runs the normal e2e seed.
   - It writes 20 files `apps/docs/public/shots/<page>-<en|pl>-<desktop|phone>.png`, for the pages onboarding, mailboxes, settings, rules and activity (`SHOT_PAGES`). Desktop is 1280x800, phone is Pixel 7. The folder is git-ignored (`.gitignore:63`).
   - Before the first shot it checks `/api/me` features is empty (`shotFeaturesProblem`). Before each shot it runs the flagged-text rule `shotTextProblem` on the page text (`publicContentProblems`, R1–R7). Only `anna@firma.pl` is allowed (`SHOT_TEXT_ALLOW`). A problem fails the run with `public_content <rule> <match> in shot <name>`.
   - The last test runs `shotFilesProblem`: exactly the 20 PNGs, each larger than `SHOT_MIN_BYTES`. — observed
3. Image-path check at build (`apps/docs/integrations/image-check.ts:checkImages`, wired at `astro.config.mjs:91`). Every image source must be a `data:` URI, a path in the shots folder, `favicon.svg` or `public/brand/`. Anything else fails with `image_outside <src> in <page>`. `.mp4` and `.vtt` are ignored. `<Shot>` fails with `shot_missing <name>` when `DOCS_SHOTS=on` and a file is missing. — observed
4. The `Shot.astro` build calls `shotSourceKind()` = `shotSource().kind`. It picks `DEMO_SHOTS` alt texts ("demo organization") or `SHOTS` alt texts. Same names and paths. — observed
5. Docs deploy (`.github/workflows/docs-deploy.yml:120-132`):
   - The deploy runs `bun run docs:shots` with no `DEMO_SEED_FILE`, then `bun apps/docs/scripts/demo-fetch.ts`, then `docs:build` with `DOCS_SHOTS=on`. A CI checkout has no seed file, so CI always makes e2e shots.
   - Hold: `OWNER_REVIEW_PENDING` is a constant in `apps/docs/src/publish-gate.ts` with five ids: `index`, `security`, `pricing`, `reference/api`, `reference/autonomy-evidence`. While it is not empty, a pushed tag does not deploy (`deploy-gate.ts:deployDecision`). A manual run deploys only with the `publish_held_pages` input. No env or flag lifts it.
   - Video: `demo-fetch.ts` prints `demo_video off` and downloads nothing while `DEMO_VIDEO_SHA256` is `null` (`apps/docs/src/demo-video.ts`, now null; `DEMO_CAPTION_SHA256` en/pl also null). With a pin it runs `gh release download demo-video --pattern 'demo*'`. It fails on a missing, extra or over-20 MB file, on a hash mismatch, and on a caption pin that is null next to a video pin. — observed
6. What must change, and what G2 blocks:
   - Shots: nothing in the shot code, unless the owner wants CI to publish demo shots. CI cannot read a file outside git. The choices are:
     - G2: commit the seed to `apps/web/e2e/demo/demo-seed.json`. Then CI picks the demo source by itself through the default path.
     - Add a pinned release asset with a download step, like the video. This is not built. I found no code for it. — guessed
   - G2 (`notes/2026-11-20-f121-close-out.md:13`): commit only if the export is under 5 MB and scanned. A commit to the public repo cannot be undone. A seed outside git means shots from it stay local, and CI and the site keep e2e shots. This is observed for the workflow. The statement that no code builds a pinned shot asset is guessed.
   - Video: `apps/web/e2e/demo/record.spec.ts:46` throws `demo_source_recording_not_built` for any non-e2e source. `bun run demo:record --seed <C1>` records nothing until that is built. The F151 ticket's own scope covers this. The ticket body (`ticket.md`) is still the empty template. — observed

Checks:
- `apps/web/e2e/lib/shot-source.test.ts` covers `shotSource`. `apps/docs/src/shots.test.ts` covers the shot list and the rules. `apps/docs/integrations/image-check.test.ts`, `apps/docs/scripts/demo-fetch.test.ts` and `deploy-gate.test.ts` cover the checks and gates. I ran none of them.
- None of them proves a real C1 export imports. The demo-import integration test of F121 stage 07 uses a test-made seed, not C1.
````

## Scout 4

Job: `2026-11-20-f151-scout-4-4f202d8c`

Question:

> Can the demo recording triage a newly delivered mail live (so that an urgent mail produces an urgent triage row and a Telegram notice) without real LLM spend: which config keys set the triage scope (TRIAGE_LLM_SCOPE values off/synthetic/...), the LLM role table and providers (is there a fake or loopback provider, does OPENAI_BASE_URL accept a loopback http URL), how the urgent detector and notice queue run (which jobs, which worker), and how the history check job that builds the shadow report ('what I would have done') is claimed and gated. Also what the sim stack (lab) uses for triage. Context: spec/features/planned/F151-the-demo-video-and-the-docs-screenshots-come-from-the-synthetic-demo-week-export/ticket.md and spec/features/done/2026-11/F121-e10b-public-pages-and-demo/stage-09-question.md. Answer for the code at HEAD.

Packet:

````text
Packet: Can the demo recording triage a new mail live (urgent row plus Telegram notice) with no real LLM spend; which config, roles, jobs and gates apply
Base: e8f6f2b1
Verified: read of `apps/server/src/platform/llm/providers/endpoint.ts:parseLlmBaseUrl` plus its test title `endpoint.test.ts:39` -> `test("4: http to loopback or a one-label host is own"`. I ran no stub end to end.
Unknowns:
- No existing loopback stub answers the classifier JSON schema. I found none (`tools/` holds only `eslint-rules`, `fake-telegram`, `mail-oauth-spike`). `platform/llm/testing.ts:createFixedLlmClient` is test-only and cannot be set from env. I did not check which JSON schema the classifier sends.
- I did not check whether the e2e or demo seed mail has `@ea-seed.test` Message-IDs. `synthetic` scope needs them (or a sender in `TEST_SENDER_ADDRESSES`).
- I did not read how the e2e trust org seeds its `history_checks` row or its `trust_ladder` flag. I did not check whether the history job can read mail from GreenMail in the demo.

1. Scope: `TRIAGE_LLM_SCOPE` is `off|synthetic|all`, default `off` (`platform/config-llm.ts:104`). `main.ts:98-109` maps it. With `off`, `triageScope()` returns null and `main.ts:264` skips the whole block: `triage.worker`, `trust.history`, `loops.analyze` and `replies.drafter` never start. With `synthetic`, the worker claims only test mail (`jobs.ts:125`, `syntheticOnly`): a Message-ID ending `@ea-seed.test` (`mail/seed.ts:20,23`) or a sender in `TEST_SENDER_ADDRESSES`. The e2e server hard-codes `off` (`apps/web/e2e/env.ts:83`). — observed
2. Providers and loopback: `LLM_PROVIDER` is `gemini|openai|deepseek`, with no fake provider (`providers/index.ts:48-51`). `OPENAI_BASE_URL=http://127.0.0.1:<port>/v1` passes the check. A loopback or one-label host is kind `own` without `OPENAI_ENDPOINT_KIND` (`endpoint.ts:52-82`). Set `LLM_PROVIDER=openai` and `OPENAI_OWN_MODEL=<any>`; config refuses an own endpoint without it (`openai-env.ts:33-35`). The key defaults to the dummy `own` (`openai-env.ts:8`), so no real key is needed. The own kind costs 0, and the reasoning field is omitted (`openai.ts:206-207`). An own endpoint with `TRIAGE_LLM_SCOPE=all` is allowed on openai because `realMail` is true. DeepSeek with scope `all` is refused outside `LAB_STACK=ea-sim` (`config-llm.ts:139-145`). `docs/capabilities/triage.md` line 16 holds the tier and model table. — observed
3. Urgent path: no worker produces an `urgent` row with the scope off. The `triage.worker` job (`main.ts:284`, every 15 s) classifies a mail, and a VIP rule only changes the classifier input (`docs/capabilities/triage.md:11`). `detectUrgent` (`channels/notices/urgent.ts:21`) reads `listTriagedBetween(categories:["urgent"])` over 24 h, skips Junk, and calls `queue`. It is one of the `detectors` (`notices/index.ts:35-36`) and runs with the `channels.notifier` job (`main.ts:482`, every 15 s, `runtime.notify()`). That job exists only when `TELEGRAM_BOT_TOKEN` is set. `TELEGRAM_API_ROOT` points it at the fake Telegram (`e2e/env.ts:84-85`), so the e2e env already has this. The urgent notice needs a linked chat, because the detector reads member link times. — observed
4. History check: the `trust.history` job runs every 15 s (`main.ts:303`) and only when `scope !== null`. Each run calls `queueFlagOnChecks` (`trust/history-job.ts:341`): with `trust_ladder` on, every active mailbox with no check gets one. `claimNextCheck` (`history-queue.ts:121`) then claims the oldest due check per org with `FOR UPDATE SKIP LOCKED`. `gateOf` (`history-job.ts:84-95`) waits on a suspended org, a flag off (a `cli` reason check ignores the flag), a paused mailbox or a blocked host, and ends on `auth_refused`. It reads mail through `openImapProvider` and classifies a sample with the same `llm` and `pause`. With `synthetic`, `listHistoryCandidates` keeps test mail only (`mail/repo/history.ts:55,73`). — observed
5. Sim stack (lab): `deploy/sim.env.example` sets `LAB_STACK=ea-sim`, `TRIAGE_LLM_SCOPE=all`, the fake Telegram on `127.0.0.1:8090`, and a real provider key. `LLM_PROVIDER` may be openai, gemini or deepseek (lines 33-40). So sim triage calls a real paid model. `docs/capabilities/live-lab.md` rule 26 says the same. Config accepts the own loopback endpoint on that stack too. — observed

Checks: `endpoint.test.ts` (rules 4 and T1) covers acceptance of loopback http URLs; it misses any triage run against a stub. `docs/capabilities/live-lab.md` rule 10 documents steps 2, 3 and 5 as not live; no test runs a live urgent triage in the e2e stack.
````
