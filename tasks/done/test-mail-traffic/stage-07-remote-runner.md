# test-mail-traffic — Stage 7

Part of [`../test-mail-traffic.md`](../test-mail-traffic.md). Read that file's "Facts checked" (bundle, VPS), "Design decisions" (D1, D10, D11, D12) and "Rules for every step" first.

## Stage 7 — Remote runner `testmail:remote` (bundle, scp, ssh) [risky]

Why risky: security. It builds code that runs on the VPS with the production DB and the mailbox password, and it builds a shell command for a remote host.
No value from a batch file, a send log or mail data may reach the remote command line; every interpolated value is validated against a strict pattern.

No step in this stage contacts the VPS. Tests use `--dry-run` and injected `run`/`buildBundle` functions. Stage 9 runs it for real.

- [x] **7.1 Remote plan, bundle check, output parsing (module code)**
  - Goal: pure and injectable parts of the remote run.
  - Files: create `apps/server/src/modules/testmail/remote.ts`, `apps/server/src/modules/testmail/remote.test.ts`; change `apps/server/src/modules/testmail/index.ts`.
    `remoteTargetSchema`, `loadRemoteTarget` and `evals/testmail/target.json` exist since stage 4.2.
  - Interfaces:

    ```ts
    export function remoteBundlePath(runId: string): string; // `/tmp/ea-testmail-${runId}.js`; runId must be a UUID (randomUUID per run)
    export function remoteCommand(
      target: RemoteTarget,
      command: "deliver" | "compare",
      opts: { bundlePath: string; bar?: number; minKept?: number; checkOnly?: boolean }
    ): string;
    export function findEnvValuesInBundle(bundle: string, env: Record<string, string | undefined>): string[]; // names of env keys whose values occur in the bundle
    export function parseDeliverOutput(stdout: string): {
      lines: { case: string; result: CaseDelivery["result"]; folder: string | null }[];
      bad: number;
    };
    export function deliveredLogLines(
      batchId: string,
      parsed: ReturnType<typeof parseDeliverOutput>["lines"],
      now: Date
    ): SendLogLine[]; // skips not_found
    ```

  - Decisions:
    - `remoteCommand` returns exactly (one line; `<b>` = `opts.bundlePath`, which must match `^/tmp/ea-testmail-[0-9a-f-]{36}\.js$`):
      `cd <remoteDir> && docker compose <composeArgs> run --rm -T -v <b>:<b>:ro server bun <b> <command> --org-id <orgId> --mailbox-id <mailboxId>[ --check-only][ --bar <bar> --min-kept <minKept>]; code=$?; rm -f <b>; exit $code`.
      `--check-only` only for `deliver`; `bar` must be a number 0–1 (printed with `String(bar)`), `minKept` an int 1–10000; else `HardError`. It re-parses `target`
      with `remoteTargetSchema` first. A unique path per run, so two remote runs never share or delete each other's bundle.
      Fact: stdin and the exit code pass through `ssh` and `docker compose run -T` (probe 2026-11-07: exit 2 and stdin JSON came back).
    - `findEnvValuesInBundle`: for each env key whose name matches `/KEY|TOKEN|PASSWORD|SECRET|HASH|PHONE|DATABASE_URL|CREDENTIALS|IMAP_USER/` (the local `.env`
      also has `TELEGRAM_API_HASH`, `TELEGRAM_TEST_PHONE`, `IMAP_USER`) and whose value has 8 or more characters, check
      `bundle.includes(value)`; return the key names only (never the values).
    - `parseDeliverOutput`: only stdout lines that start with `{` are read (other lines, e.g. a log line, are ignored); each must parse as `{case, result, folder}` with
      the stage 5 result enum and `folder` in `deliverFolderKeys` or null, else it counts as `bad`. Each line from `deliveredLogLines` is checked with
      `sendLogLineSchema` before any append (a failing line counts as `bad`), so a remote answer can never damage the send log.
    - `deliveredLogLines`: `moved`/`in_inbox`/`duplicate_removed`/`synced` → `delivered` lines with `folder` (`db` for synced, `inbox` for in_inbox, else the sort folder key).
  - Test:
    1. `remoteCommand(pilotTarget, "deliver", { bundlePath })` equals the expected string; with `{ bar: 0.98, minKept: 30 }` for `compare` the flags are appended;
       `checkOnly: true` adds ` --check-only` for `deliver` and throws for `compare`.
    2. `bar: 2`, `minKept: 0`, a bundle path `/tmp/x.js` or `/tmp/ea-testmail-../x.js` → throws; a bad target object → throws (schema from stage 4).
    3. `findEnvValuesInBundle("abc SECRETVALUE123 def", { FOO_KEY: "SECRETVALUE123", PATH: "SECRETVALUE123", SHORT_KEY: "abc" })` → `["FOO_KEY"]`.
    4. `parseDeliverOutput` of 2 good lines, 1 line `[mail] deliver …` and 1 line `{"case":1}` → 2 lines, `bad` 1; `deliveredLogLines` drops `not_found` and maps `synced` to folder `db`.
  - Check: `bun run lint && bun run typecheck && bun run test:unit`
  - Done when: tests 1–4 pass.
  - Out of scope: spawning processes (7.2).

- [x] **7.2 CLI `testmail:remote`**
  - Goal: one command from the PC that runs `testmail-target` on the VPS for a batch, with reviewed code only.
  - Files: create `apps/server/src/scripts/testmail-remote.ts`, `apps/server/src/modules/testmail/bundle.ts`, `apps/server/test/integration/testmail-remote.test.ts`;
    change `package.json` (`"testmail:remote": "bun apps/server/src/scripts/testmail-remote.ts"`), `apps/server/src/modules/testmail/index.ts`.
  - Interfaces (usage):

    ```text
    usage: bun run testmail:remote deliver --batch <id> [--check-only] [--dry-run] [--print-input]
           bun run testmail:remote compare --batch <id> [--bar 0.98] [--min-kept 30] [--out <file.md>] [--dry-run] [--print-input]
      It bundles testmail-target from a clean worktree of origin/master, copies it to the VPS of evals/testmail/target.json, and runs it in a one-off
      server container. Exit code = the remote exit code (1 on a git, build, scp or ssh error).
    ```

    ```ts
    // modules/testmail/bundle.ts
    export interface BuiltBundle {
      path: string;
      sha: string;
      text: string;
    }
    export async function buildBundleFrom(rootDir: string, outDir: string): Promise<{ path: string; text: string }>; // Bun.build of <rootDir>/apps/server/src/scripts/testmail-target.ts, target "bun", no env/define
    export async function buildReviewedBundle(
      deps: { run(argv: string[], opts?: { cwd?: string }): Promise<{ code: number; stdout: string }> },
      opts: { repoRoot: string; outDir: string; cacheDir: string } // real cacheDir: join(homedir(), ".cache/ea-testmail")
    ): Promise<BuiltBundle>;
    // scripts/testmail-remote.ts
    export interface RemoteDeps {
      run(argv: string[], opts?: { cwd?: string; stdin?: string }): Promise<{ code: number; stdout: string }>; // Bun.spawn, argv array, stderr inherited
      buildBundle(outDir: string): Promise<BuiltBundle>;
      now(): Date;
      randomId(): string;
      paths: TestmailPaths; // real: testmailPaths() (logs and lock in ~/.local/state/ea-testmail, D6); tests: testmailPaths({ TESTMAIL_ROOT: <tmp> }), so no process.env change leaks to other test files
    }
    export async function main(argv: string[], deps: RemoteDeps): Promise<number>; // the file calls main(process.argv.slice(2), realDeps) only when import.meta.main
    ```

  - Decisions:
    - Steps: load target (`loadRemoteTarget`), personas, batch and the batch log (`readSendLog`; a bad line in the middle → exit 1, `send log damaged`);
      `buildTargetInput(batch, lines, "<username>@agentmail.to")`.
      `--print-input` → print the JSON and exit 0 (no git, no build, no ssh; local use: `… --print-input | bun run testmail:target compare --org-id … --mailbox-id …`).
    - No case has a `messageId` → print `nothing sent yet`, exit 2 (no build, no ssh).
    - `buildReviewedBundle`: `git fetch origin master` (the child inherits the environment, so `GIT_SSH_COMMAND` reaches git; a non-zero exit →
      `HardError("git fetch origin master failed: on this PC set GIT_SSH_COMMAND=\"ssh -i $HOME/.ssh/github -o IdentitiesOnly=yes\"")`; never fall back to the
      local `origin/master` ref, it can be old) → `git rev-parse origin/master` = sha → worktree `<cacheDir>/<sha>`: when missing,
      `git worktree add --detach <dir> <sha>`; then `bun install --frozen-lockfile` in it every time (fast when nothing changed; it repairs a failed first install);
      when `<dir>/apps/server/src/scripts/testmail-target.ts` is missing → `HardError("origin/master has no testmail-target: push the testmail code first")`.
      Then `buildBundleFrom(<dir>, outDir)`. Other folders under `<cacheDir>` are removed with `git worktree remove --force <dir>` (only those folders; never another
      worktree); a failed remove → a warning on stderr, go on. Print `bundled origin/master <sha>`.
      Never build from the shared working tree (it can hold unreviewed S3/S4 code).
    - After the build: `findEnvValuesInBundle(text, process.env)` not empty → print `bundle holds env values: <key names>; refused`, exit 1.
    - `--dry-run`: build as above, then print the scp argv, the ssh argv (with the remote command string) and the stdin size; exit 0; no scp or ssh process.
    - Run: bundle path `remoteBundlePath(randomId())`; `scp -q -o BatchMode=yes <local bundle> <host>:<bundle path>`; then `ssh -o BatchMode=yes <host> <remoteCommand>`
      with the target input JSON on stdin. A non-zero scp exit → exit 1.
    - `deliver`: take the send lock (`acquireSendLock`, stage 4) for the whole command, because it appends to the batch log. Parse stdout with `parseDeliverOutput`;
      append `deliveredLogLines` (not with `--check-only`); print `moved <n>, in inbox <n>, duplicates removed <n>, synced <n>, not found <n>` and the `not_found` case
      ids. `bad` > 0 → print `remote output not understood: <n> lines`, exit 1.
    - `compare`: print stdout unchanged; `--out <file>` also writes it.
    - Exit with the ssh exit code; 255 → print `ssh to <host> failed`, exit 1. Delete the local out dir in `finally`.
  - Test (`testmail-remote.test.ts`, in-process `main` with fake deps; `TESTMAIL_ROOT` = a temp folder with fixture files; no network, no real git):
    1. `deliver --dry-run` → exit 0; output has `ssh -o BatchMode=yes home_vm cd ~/email_assistant && docker compose … /tmp/ea-testmail-<uuid>.js …`; `run` was called for no scp/ssh.
    2. `deliver`: fake `run` gives scp exit 0, ssh stdout `[mail] deliver …` + 2 JSON lines (`moved`, `not_found`), exit 2 → our exit 2; the batch log gets 1 `delivered` line;
       the stdin passed to ssh parses with `targetInputSchema`; the lock file is gone after the run.
    3. `deliver --check-only` → no `delivered` line is written; the remote command has ` --check-only`.
    4. `compare --out <tmp>/r.md` with canned stdout → the file equals the stdout; exit 0 passes through.
    5. scp exit 1 → exit 1, ssh not called. ssh exit 255 → exit 1 with `ssh to home_vm failed`.
    6. `--print-input` → JSON on stdout; `buildBundle` and `run` not called. A batch with no sent case → exit 2 `nothing sent yet`, no build.
    7. `buildReviewedBundle` with a fake `run` and `cacheDir` = a temp folder: the argv order is `git fetch origin master`, `git rev-parse origin/master`, `git worktree add --detach …`, `bun install --frozen-lockfile`;
       a missing entry file → the `push the testmail code first` error; `git fetch` exit 128 → the error names `GIT_SSH_COMMAND`, and no `rev-parse`/`worktree` call follows.
    8. Bundle check (real build, test timeout 60 s): `buildBundleFrom(<repo root>, <tmp>)` → `findEnvValuesInBundle(text, process.env)` is `[]`. `bun test` loads `.env`, so `DATABASE_URL`,
       `CREDENTIALS_KEY` and `AGENTMAIL_API_KEY` hold real values here; the assertion prints key names only. Skip a key that is unset.
  - Check: `bun run lint && bun run typecheck && bun run test:unit && bun run test:int`
  - Done when: tests 1–8 pass. The real run is stage 9.
  - Out of scope: any VPS contact; a VPS deploy.
