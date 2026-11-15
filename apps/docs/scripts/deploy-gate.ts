// The gate of `.github/workflows/docs-deploy.yml` (ADR 0030 point 2): does this run publish the docs?
// A pushed tag publishes only when it is the newest plain `v<x.y.z>` tag. A manual run publishes any ref (a rollback to an old tag).
// The workflow passes `GATE_EVENT`, `GATE_REF_TYPE` and `GATE_REF_NAME` as env (never inside the script text) and the output of
// `git tag --list 'v*'` on stdin. The script writes `deploy=true|false` to `$GITHUB_OUTPUT` and exits 1 on an `error`.
import { appendFileSync } from "node:fs";
import { createCliOutput } from "../../server/src/platform/cli";

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
  /** A problem that fails the workflow (a bad input). Stage 13 adds the "tag has no changelog release" error. */
  error?: string;
}

// Plain SemVer release tag: `v1.2.3`. No pre-release, no build part, no leading zero.
const RELEASE_TAG = /^v(0|[1-9]\d{0,17})\.(0|[1-9]\d{0,17})\.(0|[1-9]\d{0,17})$/;

type Version = readonly [bigint, bigint, bigint];

function releaseVersion(tag: string): Version | null {
  const match = RELEASE_TAG.exec(tag);
  if (!match) return null;
  return [BigInt(match[1] ?? "0"), BigInt(match[2] ?? "0"), BigInt(match[3] ?? "0")];
}

// Numeric order of the three parts (never text order: `v0.10.0` is newer than `v0.9.0`).
function compareVersions(a: Version, b: Version): number {
  for (let i = 0; i < 3; i += 1) {
    const left = a[i] ?? 0n;
    const right = b[i] ?? 0n;
    if (left !== right) return left > right ? 1 : -1;
  }
  return 0;
}

// The highest plain release tag of the list, or null when there is none.
export function newestRelease(tags: readonly string[]): string | null {
  let best: { tag: string; version: Version } | null = null;
  for (const raw of tags) {
    const tag = raw.trim();
    const version = releaseVersion(tag);
    if (version === null) continue;
    if (best === null || compareVersions(version, best.version) > 0) best = { tag, version };
  }
  return best === null ? null : best.tag;
}

export function deployDecision(ref: GateRef, tags: readonly string[]): GateDecision {
  if (ref.event !== "push" && ref.event !== "workflow_dispatch") {
    return { deploy: false, reason: "unknown event", error: `unknown event ${JSON.stringify(ref.event)}` };
  }
  if (ref.type !== "tag" && ref.type !== "branch") {
    return { deploy: false, reason: "unknown ref type", error: `unknown ref type ${JSON.stringify(ref.type)}` };
  }
  if (ref.name.trim() === "") {
    return { deploy: false, reason: "no ref name", error: "empty ref name" };
  }
  if (ref.event === "workflow_dispatch") {
    return { deploy: true, reason: `manual run on ${ref.type} ${ref.name}` };
  }
  // A push: only a tag publishes.
  if (ref.type !== "tag") {
    return { deploy: false, reason: `skip: ${ref.name} is not a tag` };
  }
  if (releaseVersion(ref.name) === null) {
    return { deploy: false, reason: `skip: ${ref.name} is not a release tag` };
  }
  // The pushed tag counts even when the tag list misses it (a fetch without it).
  const newest = newestRelease([...tags, ref.name]) ?? ref.name;
  if (newest !== ref.name) {
    return { deploy: false, reason: `skip: ${ref.name} is not the newest release (${newest})` };
  }
  return { deploy: true, reason: `${ref.name} is the newest release` };
}

const EXIT_OK = 0;
const EXIT_ERROR = 1;

export async function main(
  env: Readonly<Record<string, string | undefined>>,
  readTags: () => Promise<string>
): Promise<number> {
  const out = createCliOutput("deploy-gate");
  const decision = deployDecision(
    {
      event: (env.GATE_EVENT ?? "") as GateEvent,
      type: (env.GATE_REF_TYPE ?? "") as GateRefType,
      name: env.GATE_REF_NAME ?? "",
    },
    (await readTags()).split("\n")
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
  process.exit(await main(process.env, () => new Response(Bun.stdin.stream()).text()));
}
