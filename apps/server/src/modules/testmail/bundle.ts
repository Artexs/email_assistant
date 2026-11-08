import { existsSync, mkdirSync, readdirSync, lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { HardError } from "../../platform/errors";
import { createLog } from "../../platform/log";

export interface BuiltBundle {
  path: string;
  sha: string;
  text: string;
}

export interface BundleRun {
  run(argv: string[], opts?: { cwd?: string }): Promise<{ code: number; stdout: string }>;
}

const ENTRY = "apps/server/src/scripts/testmail-target.ts";
const log = createLog("testmail");
const SHA = /^[0-9a-f]{40}$/;

/** Bundles the CLI with no `define` and no env inlining, so no env value can enter the file. */
export async function buildBundleFrom(rootDir: string, outDir: string): Promise<{ path: string; text: string }> {
  const result = await Bun.build({ entrypoints: [join(rootDir, ENTRY)], outdir: outDir, target: "bun" });
  const output = result.outputs[0];
  if (!result.success || output === undefined) {
    const reasons = result.logs.map((entry) => entry.message).join("; ");
    throw new HardError(`bundle build failed: ${reasons}`);
  }
  return { path: output.path, text: readFileSync(output.path, "utf8") };
}

export async function buildReviewedBundle(
  deps: BundleRun,
  opts: { repoRoot: string; outDir: string; cacheDir: string }
): Promise<BuiltBundle> {
  const { repoRoot, outDir, cacheDir } = opts;
  const fetched = await deps.run(["git", "fetch", "origin", "master"], { cwd: repoRoot });
  if (fetched.code !== 0) {
    throw new HardError(
      'git fetch origin master failed: on this PC set GIT_SSH_COMMAND="ssh -i $HOME/.ssh/github -o IdentitiesOnly=yes"'
    );
  }
  const parsed = await deps.run(["git", "rev-parse", "refs/remotes/origin/master"], { cwd: repoRoot });
  const sha = parsed.stdout.trim();
  if (parsed.code !== 0 || !SHA.test(sha)) throw new HardError("git rev-parse refs/remotes/origin/master failed");

  const dir = join(cacheDir, sha);
  if (!existsSync(dir)) {
    mkdirSync(cacheDir, { recursive: true });
    const added = await deps.run(["git", "worktree", "add", "--detach", dir, sha], { cwd: repoRoot });
    if (added.code !== 0) throw new HardError("git worktree add failed");
  } else {
    // A reused folder must be exactly the reviewed commit, with no local change.
    const head = await deps.run(["git", "-C", dir, "rev-parse", "HEAD"]);
    const status = await deps.run(["git", "-C", dir, "status", "--porcelain"]);
    if (head.code !== 0 || head.stdout.trim() !== sha || status.code !== 0 || status.stdout.trim() !== "") {
      throw new HardError(`bundle worktree ${dir} is not a clean checkout of ${sha}: remove it and run again`);
    }
  }
  // Every time: it is fast when nothing changed, and it repairs a failed first install.
  const installed = await deps.run(["bun", "install", "--frozen-lockfile"], { cwd: dir });
  if (installed.code !== 0) throw new HardError("bun install --frozen-lockfile failed in the bundle worktree");
  if (!existsSync(join(dir, ENTRY))) {
    throw new HardError("origin/master has no testmail-target: push the testmail code first");
  }

  const built = await buildBundleFrom(dir, outDir);

  // Old worktrees of this cache only: a folder named by a full commit sha, never another worktree.
  for (const name of readdirSync(cacheDir)) {
    const old = join(cacheDir, name);
    if (name === sha || !SHA.test(name) || !lstatSync(old).isDirectory()) continue;
    const removed = await deps.run(["git", "worktree", "remove", "--force", old], { cwd: repoRoot });
    if (removed.code !== 0) log.warn(`could not remove old bundle worktree ${name}`);
  }
  return { path: built.path, sha, text: built.text };
}
