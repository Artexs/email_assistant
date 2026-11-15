import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// F114 stage 05: a temp copy of the repo layout with recording stubs (`docker`, `git`, `curl`, `df`, `deploy/backup.sh`)
// first on PATH. `release.sh` and `rollback.sh` run in it. No real Docker, git or network.
// Each stub writes one line per call to `calls.log` in the root. Switches are files in `stubs/`:
//   docker-fail     the text of an argument list that makes `docker` exit 1 (a substring of "compose ... build server")
//   missing-images  one image name per line that `docker image inspect` refuses
//   images          the tags `docker images ea-server` prints, one per line
//   git-status      the output of `git status --porcelain`
//   missing-tag, not-ancestor   make `git rev-parse` of a tag and `git merge-base --is-ancestor` fail
//   package-version the version `git show <tag>:package.json` prints (default: the tag without `v`)
//   curl-fail       `/health` answers 000
//   df-values       free bytes, one value per `df` call (the last one repeats); default 10 GiB
//   backup-bad      `deploy/backup.sh` prints no `backup ok` line

const DEPLOY = join(import.meta.dir, "..");
const GIB = 1024 * 1024 * 1024;

export interface Harness {
  root: string;
  stubs: string;
  setSwitch(name: string, content?: string): void;
  writeState(state: Partial<Record<StateKey, string>>): void;
  state(): Record<StateKey, string> | null;
  calls(): string[];
  run(script: "release.sh" | "rollback.sh", args?: string[], env?: Record<string, string>): RunResult;
  cleanup(): void;
}

export type StateKey = "current" | "current_commit" | "previous" | "previous_commit" | "pending";
export interface RunResult {
  code: number;
  stdout: string;
  output: string;
}

export const GIB_BYTES = GIB;

function stub(dir: string, name: string, body: string): void {
  const file = join(dir, name);
  writeFileSync(file, `#!/usr/bin/env bash\nS="$STUB_DIR"\nCALLS="$STUB_ROOT/calls.log"\n${body}\n`);
  chmodSync(file, 0o755);
}

export function createHarness(): Harness {
  const root = mkdtempSync(join(tmpdir(), "release-test-"));
  const stubs = join(root, "stubs");
  mkdirSync(stubs);
  mkdirSync(join(root, "deploy", "release-state"), { recursive: true });
  for (const name of ["release.sh", "rollback.sh", "release-lib.sh"]) {
    copyFileSync(join(DEPLOY, name), join(root, "deploy", name));
  }
  chmodSync(join(root, "deploy", "release.sh"), 0o755);
  chmodSync(join(root, "deploy", "rollback.sh"), 0o755);
  writeFileSync(join(root, ".env"), "");
  writeFileSync(join(stubs, "images"), "");

  stub(
    stubs,
    "docker",
    `echo "EA_RELEASE=\${EA_RELEASE:-} docker $*" >>"$CALLS"
if [[ -f "$S/docker-fail" && "$*" == *"$(cat "$S/docker-fail")"* ]]; then exit 1; fi
if [[ "$1 $2" == "image inspect" ]]; then
  ! grep -qx "\${@: -1}" "$S/missing-images" 2>/dev/null
  exit
fi
if [[ "$1" == images ]]; then cat "$S/images"; exit 0; fi
if [[ "$1" == compose ]]; then
  case " $* " in
    *" up "*) echo "\${EA_RELEASE:-}" >"$S/running-release" ;;
    *" exec "*)
      if [[ -n "\${STUB_SERVER_RELEASE+x}" ]]; then echo "$STUB_SERVER_RELEASE"; else cat "$S/running-release" 2>/dev/null || true; fi ;;
  esac
fi
exit 0`
  );
  stub(
    stubs,
    "git",
    `echo "git $*" >>"$CALLS"
case "$1" in
  status) cat "$S/git-status" 2>/dev/null || true ;;
  rev-parse)
    case "$*" in
      *'^{commit}'*) [[ -f "$S/missing-tag" ]] && exit 1; ref="\${@: -1}"; ref="\${ref#refs/tags/}"; echo "commit-\${ref%%^*}" ;;
      *HEAD*) echo "commit-head" ;;
    esac ;;
  merge-base) [[ -f "$S/not-ancestor" ]] && exit 1 ;;
  show)
    tag="\${2%%:*}"
    version="\${tag#v}"; [[ -f "$S/package-version" ]] && version="$(cat "$S/package-version")"
    printf '{\\n  "name": "email-assistant",\\n  "private": true,\\n  "type": "module",\\n  "version": "%s",\\n  "workspaces": []\\n}\\n' "$version" ;;
esac
exit 0`
  );
  stub(
    stubs,
    "curl",
    `echo "curl $*" >>"$CALLS"
if [[ -f "$S/curl-fail" ]]; then printf 000; exit 7; fi
printf 200`
  );
  stub(
    stubs,
    "df",
    `echo "df $*" >>"$CALLS"
file="$S/df-values"
if [[ -s "$file" ]]; then value="$(head -n 1 "$file")"; [[ "$(wc -l <"$file")" -gt 1 ]] && sed -i 1d "$file"; else value=${10 * GIB}; fi
printf 'Avail\\n%s\\n' "$value"`
  );
  // The backup script of the temp layout: stdout ends with the `backup ok` line, a failed ping prints on stderr after it.
  writeFileSync(
    join(root, "deploy", "backup.sh"),
    `#!/usr/bin/env bash
echo "deploy/backup.sh PATH=$PATH" >>"$STUB_ROOT/calls.log"
if [[ -f "$STUB_DIR/backup-bad" ]]; then echo "backup: pg_dump failed"; exit 0; fi
echo "backup ok ea-20261120T100000Z.dump.age 1234"
echo "backup ping failed" >&2
`
  );
  chmodSync(join(root, "deploy", "backup.sh"), 0o755);

  const stateFile = join(root, "deploy", "release-state", "state");
  return {
    root,
    stubs,
    setSwitch(name, content = "1\n") {
      writeFileSync(join(stubs, name), content);
    },
    writeState(state) {
      const keys: StateKey[] = ["current", "current_commit", "previous", "previous_commit", "pending"];
      writeFileSync(stateFile, keys.map((key) => `${key}=${state[key] ?? ""}\n`).join(""));
    },
    state() {
      if (!existsSync(stateFile)) return null;
      const entries = readFileSync(stateFile, "utf8")
        .trim()
        .split("\n")
        .map((line) => line.split("=") as [string, string]);
      return Object.fromEntries(entries) as Record<StateKey, string>;
    },
    calls() {
      const file = join(root, "calls.log");
      return existsSync(file) ? readFileSync(file, "utf8").trim().split("\n") : [];
    },
    run(script, args = [], env = {}) {
      const result = Bun.spawnSync(["bash", join(root, "deploy", script), ...args], {
        cwd: root,
        env: {
          PATH: `${stubs}:${process.env.PATH ?? ""}`,
          HOME: root,
          STUB_DIR: stubs,
          STUB_ROOT: root,
          RELEASE_HEALTH_TIMEOUT: "0",
          RELEASE_HEALTH_INTERVAL: "0",
          ...env,
        },
      });
      const stdout = result.stdout.toString();
      return { code: result.exitCode ?? -1, stdout, output: `${stdout}${result.stderr.toString()}` };
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/** The index of the first call that contains `text`, or -1. */
export function indexOfCall(calls: readonly string[], text: string, from = 0): number {
  return calls.findIndex((line, index) => index >= from && line.includes(text));
}
