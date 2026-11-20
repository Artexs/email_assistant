# Stage 19 log: exact asserts in server unit cases (group G09)

Base: `e2bfbc7c`. Scan: `bun scripts/test-audit/scan-cli.ts`; keys: `cut-keys.ts --group G09` gave 21 keys: 17 `ok`, 4 `rejected`, none `deferred-none`/`deferred-two`.
Open branches: `limen/2026-11-19-f138-stage-02-remove-gemini-prov-e2edaabc` (not merged) changes `apps/server/src/platform/config.test.ts`, so its 3 rows are deferred. No other open `limen/*` branch changes a file of this stage.
Rewritten: 14 rows in 11 files. No product code changed. Every new assert passed on the unchanged code (`bun test` of the 11 files: 133 pass, 0 fail).

## Rewritten rows

| case (file: name) | old assert | new assert | break once (line broken: result) |
| --- | --- | --- | --- |
| `deploy-logging.test.ts`: 7. server still carries the migrator URL | `toBeDefined()` on the URL | `new URL(url ?? "").username` is `"migrator"` | `deploy/compose.yaml` server URL user `migrator` to `owner`: fails, received `"owner"` |
| `channels/telegram/api.test.ts`: edit: message is not modified counts as success | none (passes when no throw) | `await expect(edit(...)).resolves.toBeUndefined()` | `isNotModified` text check changed: the promise rejects, case fails (the old case fails too: it also throws) |
| `mail/imap/capture.test.ts`: 10: a source that is not a mail does not throw | none | `toEqual` of the whole `MailContent` (`text: null`, empty capture, `partsKnown: true`) | `safeCapture(parsed, true, …)` to `false`: fails (old case passes) |
| `mail/imap/tls-servername.test.ts`: IMAP accepts the certificate of the host name | none | `client.authenticated` is `true` before logout | login mapping removed in `imapFlowOptions`: fails at `connect()` ("Please configure the login"), before the new assert (old case fails too); the assert itself: `toBe(false)` fails with received `true` |
| `platform/heartbeat.test.ts`: does not throw when checkDb throws | none | `tick()` resolves to `undefined`; an injected fetch spy is called 0 times | `checkDb()` error swallowed as true: fetch runs, fails (old case passes) |
| `start/runs.test.ts`: only the newest run of a name counts | none | race of `settled()` against a macrotask is `"settled"` | the tracker keeps every run (`newest.set` key per run): `"waiting"`, fails (old case passes: it would hang only in the real tracker) |
| `start/runs.test.ts`: with no tracked name, settled() resolves at once | none | the same race is `"settled"` | a 20 ms wait added when nothing is tracked: `"waiting"`, fails (old case passes) |
| `modules/lab/serve-files.test.ts`: same container restarted … takes over at once | `toBeDefined()` on the lock | the lock file JSON `toEqual({ host, ns, pid, token })` with the token not `old` | new lock token forced to `old` (`BREAK_TOKEN=old`): fails (old case passes) |
| `modules/lab/serve-files.test.ts`: a lock of another PID namespace is stale by age … | `toBeDefined()` | the lock file JSON equals our identity with a token not `first-serve` | token forced to `first-serve`: fails |
| `modules/lab/serve-files.test.ts`: same host and namespace, same pid 1 … taken over at once | `toBeDefined()` | the lock file JSON equals our identity with a token not `before-the-restart` | token forced to `before-the-restart`: fails |
| `modules/testmail/agentmail/fake.test.ts`: stop closes the port | `toBeDefined()` on the failure | `toBeInstanceOf(TypeError)` | `server.stop(true)` removed: the fetch succeeds, the helper reports "did not throw", fails (old case fails too) |
| `platform/config-deepseek.test.ts`: 2d: openai and gemini load with the scope all … | two `toBeTruthy()` on the config | `llmRoleTable(config).roles.classifier.provider` is `"openai"`, then `"gemini"` | role provider forced to `gemini`: expected `"openai"`, received `"gemini"` (old case passes) |
| `scripts/e2e-job-env-args.test.ts`: a folder with no .env does nothing | `not.toThrow()` | `loadRepoDotEnv(dir)` then `process.env.F136_PROBE` is `undefined` | no-file branch sets `F136_PROBE`: fails (old case passes) |
| `scripts/org-dsr-args.test.ts`: a bad address is no usage error | `not.toThrow()` | `toEqual({ mode: "find", orgId: ID, address: "p@x." })` | the trailing dot stripped from the address: fails (old case passes) |

The break-once runs used `bun test <file> -t <case name>` on one broken product line, restored with `git checkout` after each run. The tls row is the one weak break: the broken line fails the case before the new assert, so the assert was checked by flipping its expected value.

## Deferred (3 rows)

| key | reason |
| --- | --- |
| `platform/config.test.ts:221` (an old .env with the removed writer keys still loads) | open branch `limen/2026-11-19-f138-stage-02-remove-gemini-prov-e2edaabc` changes the file (rule S3) |
| `platform/config.test.ts:295` (accepts TRIAGE_LLM_SCOPE=synthetic with a GEMINI_API_KEY …) | same |
| `platform/config.test.ts:459` (loadConfig works without the AgentMail keys) | same |

## Rejected (4 keys, not touched)

`apps/server/src/main.test.ts:42`, `:52`, `:61` (owner: a follow-up ticket replaces the source regexes), `apps/server/src/scripts/time-rewrite-check.test.ts:43` (the file is gone). Source: `audit/reject.tsv`.

## cut-proof

Command: `bun scripts/test-audit/cut-proof.ts --before /tmp/f125-s19/before-1 --before /tmp/f125-s19/before-2 --after /tmp/f125-s19/after --expect unit=+0 …`. Runs: `cut-run.sh` on the 11 files, before twice and after once. Serial time is noise (5.78 s before, 12.95 s after on a loaded machine).

Before: `/tmp/f125-s19/before-1`, `/tmp/f125-s19/before-2`. After: `/tmp/f125-s19/after`. Expected: unit=+0, int=+0.

| lane | cases before | cases after | serial time before | serial time after |
| --- | --- | --- | --- | --- |
| unit | 133 | 133 | 5.78 s | 12.95 s |
| int | 0 | 0 | 0.00 s | 0.00 s |

- Case counts: pass.
- Covered lines: pass; 1 noise files skipped.
- Mutants: not checked (no mutation.json on both sides); 0 on one side only.

Result: PASS


## Name diff

Sorted `classname|name` of the JUnit cases, `before-1/unit.xml` against `after/unit.xml`: 133 names each, `diff` is empty.
