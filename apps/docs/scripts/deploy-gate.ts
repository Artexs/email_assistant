// The gate of `.github/workflows/docs-deploy.yml` (ADR 0030 point 2): does this run publish the docs?
// A pushed tag publishes only when it is the newest plain `v<x.y.z>` tag. A manual run publishes any ref (a rollback to an old tag).
// The workflow passes `GATE_EVENT`, `GATE_REF_TYPE`, `GATE_REF_NAME` and `GATE_PUBLISH_HELD` as env (never inside the script text) and the output of
// `git tag --list 'v*'` on stdin. The script reads `CHANGELOG.md` itself. It writes `deploy=true|false` to `$GITHUB_OUTPUT`
// and exits 1 on an `error`. A pushed release tag whose version has no `## [x.y.z]` release in the changelog is an error (a failed run, not a skip).
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ChangelogError, compareSemver, parseChangelog, UNRELEASED } from "@ea/core";
import { createCliOutput } from "../../server/src/platform/cli";
import { OWNER_REVIEW_PENDING, publishHoldReason } from "../src/publish-gate";

export type GateEvent = "push" | "workflow_dispatch";
export type GateRefType = "tag" | "branch";
export interface GateRef {
  event: GateEvent;
  type: GateRefType;
  name: string;
}
export interface GateDecision {
  deploy: boolean;
  reason: string;
  /** A problem that fails the workflow: a bad input, or a pushed release tag with no changelog release (`changelog_missing x.y.z`). */
  error?: string;
}

// Plain SemVer release tag: `v1.2.3`. No pre-release, no build part, no leading zero.
const RELEASE_TAG = /^v(0|[1-9]\d{0,17})\.(0|[1-9]\d{0,17})\.(0|[1-9]\d{0,17})$/;

function isReleaseTag(tag: string): boolean {
  return RELEASE_TAG.test(tag);
}

// The highest plain release tag of the list, or null when there is none.
export function newestRelease(tags: readonly string[]): string | null {
  let best: string | null = null;
  for (const raw of tags) {
    const tag = raw.trim();
    if (!isReleaseTag(tag)) continue;
    // Numeric order of the three parts (never text order: `v0.10.0` is newer than `v0.9.0`).
    if (best === null || compareSemver(tag.slice(1), best.slice(1)) > 0) best = tag;
  }
  return best;
}

/**
 * `releases`: the versions (`x.y.z`, without `v`) of the released entries of `CHANGELOG.md`.
 * `pending`: the page ids that wait for the owner (`OWNER_REVIEW_PENDING`). `publishHeld`: the dispatch input `publish_held_pages`.
 * A run that would deploy but has a pending page is a skip, unless it is a manual run with `publishHeld`.
 */
export function deployDecision(
  ref: GateRef,
  tags: readonly string[],
  releases: readonly string[],
  pending: readonly string[],
  publishHeld: boolean
): GateDecision {
  if (ref.event !== "push" && ref.event !== "workflow_dispatch") {
    return { deploy: false, reason: "unknown event", error: `unknown event ${JSON.stringify(ref.event)}` };
  }
  if (ref.type !== "tag" && ref.type !== "branch") {
    return { deploy: false, reason: "unknown ref type", error: `unknown ref type ${JSON.stringify(ref.type)}` };
  }
  if (ref.name.trim() === "") {
    return { deploy: false, reason: "no ref name", error: "empty ref name" };
  }
  const held = publishHoldReason(pending);
  if (ref.event === "workflow_dispatch") {
    if (held !== null && !publishHeld) return { deploy: false, reason: `skip: ${held}` };
    return { deploy: true, reason: `manual run on ${ref.type} ${ref.name}` };
  }
  // A push: only a tag publishes.
  if (ref.type !== "tag") {
    return { deploy: false, reason: `skip: ${ref.name} is not a tag` };
  }
  if (!isReleaseTag(ref.name)) {
    return { deploy: false, reason: `skip: ${ref.name} is not a release tag` };
  }
  const version = ref.name.slice(1);
  if (!releases.includes(version)) {
    return { deploy: false, reason: `no changelog release ${version}`, error: `changelog_missing ${version}` };
  }
  // The pushed tag counts even when the tag list misses it (a fetch without it).
  const newest = newestRelease([...tags, ref.name]) ?? ref.name;
  if (newest !== ref.name) {
    return { deploy: false, reason: `skip: ${ref.name} is not the newest release (${newest})` };
  }
  // The hold comes last: a bad tag and an old tag keep their own answers.
  if (held !== null) return { deploy: false, reason: `skip: ${held}` };
  return { deploy: true, reason: `${ref.name} is the newest release` };
}

const EXIT_OK = 0;
const EXIT_ERROR = 1;

// The released versions of the changelog text; `Unreleased` is no release.
export function releasedVersions(changelog: string): string[] {
  return parseChangelog(changelog)
    .map((release) => release.version)
    .filter((version) => version !== UNRELEASED);
}

export async function main(
  env: Readonly<Record<string, string | undefined>>,
  readTags: () => Promise<string>,
  readChangelog: () => string,
  // A parameter, never env: nothing outside a commit lifts the hold.
  pending: readonly string[] = OWNER_REVIEW_PENDING
): Promise<number> {
  const out = createCliOutput("deploy-gate");
  let releases: string[];
  try {
    releases = releasedVersions(readChangelog());
  } catch (error) {
    if (!(error instanceof ChangelogError)) throw error;
    out.fail(`error: ${error.message}`);
    return EXIT_ERROR;
  }
  const decision = deployDecision(
    {
      event: (env.GATE_EVENT ?? "") as GateEvent,
      type: (env.GATE_REF_TYPE ?? "") as GateRefType,
      name: env.GATE_REF_NAME ?? "",
    },
    (await readTags()).split("\n"),
    releases,
    pending,
    env.GATE_PUBLISH_HELD === "true"
  );
  if (decision.error !== undefined) {
    out.fail(`error: ${decision.error}`);
    return EXIT_ERROR;
  }
  out.print(decision.deploy ? `deploy: ${decision.reason}` : decision.reason);
  const file = env.GITHUB_OUTPUT;
  if (file !== undefined && file !== "") appendFileSync(file, `deploy=${decision.deploy}\n`);
  return EXIT_OK;
}

if (import.meta.main) {
  // `EA_DOCS_REPO_ROOT` points the script at a fixture tree (tests only), as for the docs build.
  const root = process.env.EA_DOCS_REPO_ROOT ?? join(import.meta.dir, "../../..");
  process.exit(
    await main(
      process.env,
      () => new Response(Bun.stdin.stream()).text(),
      () => readFileSync(join(root, "CHANGELOG.md"), "utf8")
    )
  );
}
