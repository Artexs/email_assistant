import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { parseSendLog, targetInputSchema, type Batch, type PersonaFile, type SendLogLine } from "@ea/core";
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import { buildBundleFrom, buildReviewedBundle } from "../../src/modules/testmail/bundle";
import { testmailPaths } from "../../src/modules/testmail/paths";
import { findEnvValuesInBundle } from "../../src/modules/testmail/remote";
import { main, type RemoteDeps } from "../../src/scripts/testmail-remote";

// No network and no real git: every process goes through a fake `run`; TESTMAIL_ROOT is a temp folder.
const batchId = "2026-11-08-rem";
const uuid = "0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d";
const repoRoot = resolve(import.meta.dir, "../../../..");

const personas: PersonaFile = {
  inbox: { username: "ea-rem", clientId: "ea-rem-client", defaultDisplayName: "Default Name" },
  personas: [{ key: "anna", displayName: "Anna Kowalska", group: "work", lang: "pl", voice: "calm" }],
};

const target = {
  testAddress: "boss@interia.test",
  host: "home_vm",
  remoteDir: "~/email_assistant",
  composeArgs: "-f deploy/compose.yaml --env-file .env",
  orgId: "ac6ed6a2-ee37-461f-9632-cc08cf549e40",
  mailboxId: "8bc7f572-a7f5-4fa5-aaab-db16dc663e96",
};

const batch: Batch = {
  batch: batchId,
  writer: "test",
  cases: ["a", "b"].map((id) => ({
    id,
    persona: "anna",
    lang: "pl" as const,
    subject: `Subjectword ${id}`,
    body: `Bodyword ${id}`,
    expected: { category: "info" as const },
  })),
};

const sentA: SendLogLine = {
  type: "sent",
  batch: batchId,
  case: "a",
  attempt: 1,
  key: "k-a",
  messageId: "<a@x.test>",
  threadId: "t-a",
  inbox: "ea-rem@agentmail.to",
  via: "send",
  at: "2026-11-08T10:00:00.000Z",
};

let root: string;
let paths: ReturnType<typeof testmailPaths>;
let stdout: string[];
let stderr: string[];
let calls: { argv: string[]; stdin?: string }[];
let builds: number;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "testmail-remote-"));
  paths = testmailPaths({ TESTMAIL_ROOT: root });
  writeJson(paths.personasFile, personas);
  writeJson(paths.targetFile, target);
  writeJson(join(paths.batchesDir, `${batchId}.json`), batch);
  stdout = [];
  stderr = [];
  calls = [];
  builds = 0;
  spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
  spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  (process.stdout.write as unknown as { mockRestore(): void }).mockRestore();
  (process.stderr.write as unknown as { mockRestore(): void }).mockRestore();
});

function writeJson(file: string, value: unknown): void {
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, JSON.stringify(value));
}

function writeLog(lines: SendLogLine[]): void {
  mkdirSync(paths.runsDir, { recursive: true });
  writeFileSync(paths.batchLog(batchId), lines.map((line) => `${JSON.stringify(line)}\n`).join(""));
}

function readLog(): SendLogLine[] {
  return parseSendLog(readFileSync(paths.batchLog(batchId), "utf8")).lines;
}

function makeDeps(answer: (argv: string[]) => { code: number; stdout: string }): RemoteDeps {
  return {
    run: async (argv, opts) => {
      calls.push({ argv, ...(opts?.stdin === undefined ? {} : { stdin: opts.stdin }) });
      return answer(argv);
    },
    buildBundle: async (outDir) => {
      builds += 1;
      return { path: join(outDir, "testmail-target.js"), sha: "a".repeat(40), text: "console.log(1);" };
    },
    now: () => new Date("2026-11-08T12:00:00.000Z"),
    randomId: () => uuid,
    paths,
  };
}

const ok = () => ({ code: 0, stdout: "" });
const allOutput = () => `${stdout.join("")}${stderr.join("")}`;

describe("testmail:remote main", () => {
  test("1. deliver --dry-run prints the argv and starts no process", async () => {
    writeLog([sentA]);
    const code = await main(["deliver", "--batch", batchId, "--dry-run"], makeDeps(ok));
    expect(code).toBe(0);
    expect(stdout.join("")).toContain(
      `ssh -o BatchMode=yes home_vm cd ~/email_assistant && docker compose -f deploy/compose.yaml --env-file .env run --rm -T -v /tmp/ea-testmail-${uuid}.js:/tmp/ea-testmail-${uuid}.js:ro server bun /tmp/ea-testmail-${uuid}.js deliver`
    );
    expect(calls).toEqual([]);
    expect(existsSync(paths.lockFile)).toBe(false);
  });

  test("2. deliver appends delivered lines, passes the exit code, frees the lock", async () => {
    writeLog([sentA]);
    const deps = makeDeps((argv) =>
      argv[0] === "scp"
        ? ok()
        : {
            code: 2,
            stdout: [
              "[mail] deliver …",
              JSON.stringify({ case: "a", result: "moved", folder: "offers" }),
              JSON.stringify({ case: "b", result: "not_found", folder: null }),
              "",
            ].join("\n"),
          }
    );
    const code = await main(["deliver", "--batch", batchId], deps);
    expect(code).toBe(2);
    expect(calls.map((call) => call.argv[0])).toEqual(["scp", "ssh"]);
    expect(calls[0]?.argv).toContain(`home_vm:/tmp/ea-testmail-${uuid}.js`);
    expect(targetInputSchema.safeParse(JSON.parse(calls[1]?.stdin ?? "null")).success).toBe(true);
    const delivered = readLog().filter((line) => line.type === "delivered");
    expect(delivered).toEqual([
      {
        type: "delivered",
        batch: batchId,
        case: "a",
        folder: "offers",
        result: "moved",
        at: "2026-11-08T12:00:00.000Z",
      },
    ]);
    expect(allOutput()).toContain("moved 1, in inbox 0, duplicates removed 0, synced 0, not found 1");
    expect(existsSync(paths.lockFile)).toBe(false);
  });

  test("3. deliver --check-only writes no delivered line", async () => {
    writeLog([sentA]);
    const deps = makeDeps((argv) =>
      argv[0] === "scp"
        ? ok()
        : { code: 0, stdout: `${JSON.stringify({ case: "a", result: "in_inbox", folder: "inbox" })}\n` }
    );
    const code = await main(["deliver", "--batch", batchId, "--check-only"], deps);
    expect(code).toBe(0);
    expect(calls[1]?.argv[4]).toContain(" --check-only;");
    expect(readLog().filter((line) => line.type === "delivered")).toEqual([]);
  });

  test("4. compare --out writes the stdout and passes the exit code", async () => {
    writeLog([sentA]);
    const report = "# Testmail compare\n\n| a | info |\n";
    const deps = makeDeps((argv) => (argv[0] === "scp" ? ok() : { code: 0, stdout: report }));
    const file = join(root, "r.md");
    const code = await main(["compare", "--batch", batchId, "--bar", "0.9", "--min-kept", "5", "--out", file], deps);
    expect(code).toBe(0);
    expect(readFileSync(file, "utf8")).toBe(report);
    expect(stdout.join("")).toContain(report);
    expect(calls[1]?.argv[4]).toContain(" --bar 0.9 --min-kept 5;");
  });

  test("4b. compare --out writes no file on exit 1 and keeps an existing one", async () => {
    writeLog([sentA]);
    const file = join(root, "r.md");
    const failing = makeDeps((argv) => (argv[0] === "scp" ? ok() : { code: 1, stdout: "remote error\n" }));
    expect(await main(["compare", "--batch", batchId, "--out", file], failing)).toBe(1);
    expect(existsSync(file)).toBe(false);

    writeFileSync(file, "old report");
    expect(await main(["compare", "--batch", batchId, "--out", file], failing)).toBe(1);
    expect(readFileSync(file, "utf8")).toBe("old report");

    const waiting = makeDeps((argv) => (argv[0] === "scp" ? ok() : { code: 2, stdout: "wait\n" }));
    expect(await main(["compare", "--batch", batchId, "--out", file], waiting)).toBe(2);
    expect(readFileSync(file, "utf8")).toBe("wait\n");
  });

  test("5. scp failure stops before ssh; ssh 255 is exit 1", async () => {
    writeLog([sentA]);
    expect(
      await main(
        ["compare", "--batch", batchId],
        makeDeps(() => ({ code: 1, stdout: "" }))
      )
    ).toBe(1);
    expect(calls.map((call) => call.argv[0])).toEqual(["scp"]);

    calls = [];
    const code = await main(
      ["compare", "--batch", batchId],
      makeDeps((argv) => (argv[0] === "scp" ? ok() : { code: 255, stdout: "" }))
    );
    expect(code).toBe(1);
    expect(stderr.join("")).toContain("ssh to home_vm failed");
  });

  test("6. --print-input prints the JSON; nothing sent is exit 2 with no build", async () => {
    writeLog([sentA]);
    expect(await main(["compare", "--batch", batchId, "--print-input"], makeDeps(ok))).toBe(0);
    const parsed = targetInputSchema.parse(JSON.parse(stdout.join("")));
    expect(parsed.cases.map((item) => item.messageId)).toEqual(["<a@x.test>", null]);
    expect(builds).toBe(0);
    expect(calls).toEqual([]);

    stdout = [];
    writeLog([]);
    expect(await main(["deliver", "--batch", batchId], makeDeps(ok))).toBe(2);
    expect(stdout.join("")).toContain("nothing sent yet");
    expect(builds).toBe(0);
    expect(calls).toEqual([]);
  });

  test("a remote line that is not understood is exit 1 and nothing is appended", async () => {
    writeLog([sentA]);
    const deps = makeDeps((argv) =>
      argv[0] === "scp"
        ? ok()
        : {
            code: 0,
            stdout: `${JSON.stringify({ case: "a", result: "moved", folder: "offers" })}\n{"case":1}\n`,
          }
    );
    expect(await main(["deliver", "--batch", batchId], deps)).toBe(1);
    expect(stderr.join("")).toContain("remote output not understood: 1 lines");
    expect(readLog().filter((line) => line.type === "delivered")).toEqual([]);
  });

  test("a bundle that holds an env value is refused: exit 1, no scp or ssh, key name only", async () => {
    writeLog([sentA]);
    const value = "super-secret-value-123456";
    process.env.TESTMAIL_FAKE_API_KEY = value;
    try {
      const deps = makeDeps(ok);
      deps.buildBundle = async (outDir) => ({
        path: join(outDir, "testmail-target.js"),
        sha: "a".repeat(40),
        text: `const k = "${value}";`,
      });
      expect(await main(["deliver", "--batch", batchId], deps)).toBe(1);
      expect(calls).toEqual([]);
      expect(allOutput()).toContain("TESTMAIL_FAKE_API_KEY");
      expect(allOutput()).not.toContain(value);
    } finally {
      delete process.env.TESTMAIL_FAKE_API_KEY;
    }
  });

  test("a remote line for a case outside the batch is exit 1 and nothing is appended", async () => {
    writeLog([sentA]);
    const deps = makeDeps((argv) =>
      argv[0] === "scp"
        ? ok()
        : {
            code: 0,
            stdout: `${JSON.stringify({ case: "a", result: "moved", folder: "offers" })}\n${JSON.stringify({ case: "zzz", result: "moved", folder: "offers" })}\n`,
          }
    );
    expect(await main(["deliver", "--batch", batchId], deps)).toBe(1);
    expect(stderr.join("")).toContain("remote output not understood: 1 lines");
    expect(readLog().filter((line) => line.type === "delivered")).toEqual([]);
  });

  test("a damaged send log is exit 1", async () => {
    mkdirSync(paths.runsDir, { recursive: true });
    writeFileSync(paths.batchLog(batchId), `{bad\n${JSON.stringify(sentA)}\n`);
    expect(await main(["deliver", "--batch", batchId], makeDeps(ok))).toBe(1);
    expect(stderr.join("")).toContain("send log damaged");
  });
});

describe("buildReviewedBundle", () => {
  const sha = "b".repeat(40);
  let cacheDir: string;
  let argvs: string[][];

  beforeEach(() => {
    cacheDir = join(root, "cache");
    argvs = [];
  });

  function fakeRun(opts: {
    fetchCode?: number;
    withEntry?: boolean;
    head?: string;
    dirty?: boolean;
    removeCode?: number;
  }) {
    return async (argv: string[]) => {
      argvs.push(argv);
      if (argv[1] === "-C" && argv[3] === "rev-parse") return { code: 0, stdout: `${opts.head ?? sha}\n` };
      if (argv[1] === "-C" && argv[3] === "status") return { code: 0, stdout: opts.dirty === true ? " M a.ts\n" : "" };
      if (argv[1] === "worktree" && argv[2] === "remove") return { code: opts.removeCode ?? 0, stdout: "" };
      if (argv[1] === "fetch") return { code: opts.fetchCode ?? 0, stdout: "" };
      if (argv[1] === "rev-parse") return { code: 0, stdout: `${sha}\n` };
      if (argv[1] === "worktree" && argv[2] === "add" && opts.withEntry !== false) {
        const entry = join(cacheDir, sha, "apps/server/src/scripts/testmail-target.ts");
        mkdirSync(join(entry, ".."), { recursive: true });
        writeFileSync(entry, "console.log('hi');\n");
      }
      return { code: 0, stdout: "" };
    };
  }

  test("7a. argv order", async () => {
    const result = await buildReviewedBundle(
      { run: fakeRun({}) },
      { repoRoot: root, outDir: join(root, "out"), cacheDir }
    );
    expect(argvs.map((argv) => argv.slice(0, 3).join(" "))).toEqual([
      "git fetch origin",
      "git rev-parse refs/remotes/origin/master",
      "git worktree add",
      "bun install --frozen-lockfile",
    ]);
    expect(argvs[2]).toEqual(["git", "worktree", "add", "--detach", join(cacheDir, sha), sha]);
    expect(result.sha).toBe(sha);
    expect(result.text).toContain("hi");
  });

  test("7b. a missing entry file", async () => {
    await expect(
      buildReviewedBundle(
        { run: fakeRun({ withEntry: false }) },
        { repoRoot: root, outDir: join(root, "out"), cacheDir }
      )
    ).rejects.toThrow("push the testmail code first");
  });

  test("7c. git fetch failure names GIT_SSH_COMMAND and stops", async () => {
    await expect(
      buildReviewedBundle({ run: fakeRun({ fetchCode: 128 }) }, { repoRoot: root, outDir: join(root, "out"), cacheDir })
    ).rejects.toThrow("GIT_SSH_COMMAND");
    expect(argvs.map((argv) => argv[1])).toEqual(["fetch"]);
  });

  describe("7d. cache clean-up", () => {
    const other = "c".repeat(40);

    function fillCache(): void {
      mkdirSync(join(cacheDir, other), { recursive: true });
      mkdirSync(join(cacheDir, "notasha"), { recursive: true });
      writeFileSync(join(cacheDir, "d".repeat(40)), "file");
      symlinkSync(root, join(cacheDir, "e".repeat(40)));
    }

    const removals = () => argvs.filter((argv) => argv[1] === "worktree" && argv[2] === "remove");

    test("removes only an old sha-named folder", async () => {
      fillCache();
      await buildReviewedBundle({ run: fakeRun({}) }, { repoRoot: root, outDir: join(root, "out"), cacheDir });
      expect(removals()).toEqual([["git", "worktree", "remove", "--force", join(cacheDir, other)]]);
    });

    test("a failed remove is a warning, not an error", async () => {
      fillCache();
      const warn = spyOn(console, "error").mockImplementation(() => undefined);
      try {
        const result = await buildReviewedBundle(
          { run: fakeRun({ removeCode: 1 }) },
          { repoRoot: root, outDir: join(root, "out"), cacheDir }
        );
        expect(result.sha).toBe(sha);
        expect(warn.mock.calls.flat().join(" ")).toContain(`could not remove old bundle worktree ${other}`);
      } finally {
        warn.mockRestore();
      }
    });
  });

  describe("7e. reused worktree", () => {
    function reuse(): void {
      const entry = join(cacheDir, sha, "apps/server/src/scripts/testmail-target.ts");
      mkdirSync(join(entry, ".."), { recursive: true });
      writeFileSync(entry, "console.log('hi');\n");
    }

    test("a clean checkout of the sha is reused with no worktree add", async () => {
      reuse();
      const result = await buildReviewedBundle(
        { run: fakeRun({}) },
        { repoRoot: root, outDir: join(root, "out"), cacheDir }
      );
      expect(result.sha).toBe(sha);
      expect(argvs.some((argv) => argv[1] === "worktree" && argv[2] === "add")).toBe(false);
    });

    test("another HEAD or a local change is a HardError", async () => {
      reuse();
      const opts = { repoRoot: root, outDir: join(root, "out"), cacheDir };
      await expect(buildReviewedBundle({ run: fakeRun({ head: "f".repeat(40) }) }, opts)).rejects.toThrow(
        "not a clean checkout"
      );
      await expect(buildReviewedBundle({ run: fakeRun({ dirty: true }) }, opts)).rejects.toThrow(
        "not a clean checkout"
      );
    });
  });
});

describe("bundle check", () => {
  test("8. the real bundle holds no env value", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "testmail-bundle-"));
    try {
      const { text } = await buildBundleFrom(repoRoot, outDir);
      // Key names only: a value must never reach the test output.
      expect(findEnvValuesInBundle(text, process.env)).toEqual([]);
      // Guards against an empty or wrong bundle that would pass the check by accident.
      expect(text.length).toBeGreaterThan(1_000_000);
      expect(text).toContain("deliverTestMail");
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  }, 60_000);
});
