import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The docs jobs of `ci.yml` and the deploy workflow are wired by text: nothing runs them here (a run publishes or burns CI minutes).
// These tests read the YAML and pin the wiring that the gate and the least-privilege rule depend on.
const ROOT = join(import.meta.dir, "../../..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

interface Step {
  id?: string;
  name?: string;
  if?: string;
  "continue-on-error"?: boolean;
  uses?: string;
  run?: string;
  shell?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
}
interface Job {
  needs?: string;
  if?: string;
  "runs-on"?: string;
  services?: unknown;
  permissions?: Record<string, string>;
  environment?: { name?: string; url?: string };
  concurrency?: { group?: string; "cancel-in-progress"?: boolean };
  outputs?: Record<string, string>;
  steps?: Step[];
}
interface Workflow {
  on: { push?: { tags?: string[]; branches?: string[] }; workflow_dispatch?: unknown };
  permissions?: Record<string, string>;
  jobs: Record<string, Job>;
}

const parse = (path: string) => Bun.YAML.parse(read(path)) as Workflow;
const CI_TEXT = read(".github/workflows/ci.yml");
const DEPLOY_TEXT = read(".github/workflows/docs-deploy.yml");
const ci = parse(".github/workflows/ci.yml");
const deploy = parse(".github/workflows/docs-deploy.yml");
const steps = (job: Job | undefined): Step[] => job?.steps ?? [];
const run = (job: Job | undefined, command: string) => steps(job).find((step) => step.run === command);
const usesOf = (workflow: Workflow) =>
  Object.values(workflow.jobs).flatMap((job) => steps(job).flatMap((step) => (step.uses ? [step.uses] : [])));

describe("ci.yml job docs", () => {
  const docs = ci.jobs.docs;

  test("T1 the jobs are ci e2e image docs", () => {
    expect(Object.keys(ci.jobs).join(" ")).toBe("ci e2e image docs");
  });

  test("the file keeps read-only permissions and no job widens them", () => {
    expect(ci.permissions).toEqual({ contents: "read" });
    for (const job of Object.values(ci.jobs)) expect(job.permissions).toBeUndefined();
  });

  test("it has no services and no secret", () => {
    expect(docs?.services).toBeUndefined();
    expect(CI_TEXT).not.toMatch(/secrets\./);
  });

  test("it sets up the pinned Bun and Node 24, then a frozen install", () => {
    const list = steps(docs);
    expect(list[0]?.uses).toBe("actions/checkout@v4");
    expect(list[1]).toMatchObject({ uses: "oven-sh/setup-bun@v2", with: { "bun-version-file": ".bun-version" } });
    expect(list[2]).toMatchObject({ uses: "actions/setup-node@v4", with: { "node-version": 24 } });
    expect(list[3]?.run).toBe("bun install --frozen-lockfile");
  });

  test("it builds, then checks stale pages without --strict", () => {
    const list = steps(docs).map((step) => step.run);
    const build = list.indexOf("bun run docs:build");
    expect(build).toBeGreaterThan(list.indexOf("bun install --frozen-lockfile"));
    expect(list.indexOf("bun run docs:stale")).toBeGreaterThan(build);
    expect(list.some((command) => command?.includes("--strict"))).toBe(false);
  });

  test("it runs on every push and pull request of the file's triggers", () => {
    expect(docs?.if).toBeUndefined();
  });
});

describe("docs-deploy.yml", () => {
  const build = deploy.jobs.build;
  const job = deploy.jobs.deploy;
  const gate = steps(build).find((step) => step.id === "gate");

  test("T7 jobs are build and deploy", () => {
    expect(Object.keys(deploy.jobs).join(" ")).toBe("build deploy");
  });

  test("it runs on a v* tag push and by hand, with no input", () => {
    expect(deploy.on.push).toEqual({ tags: ["v*"] });
    expect(deploy.on.workflow_dispatch).toEqual({});
    expect(Object.keys(deploy.on).sort()).toEqual(["push", "workflow_dispatch"]);
  });

  test("T7 only the deploy job has pages: write and id-token: write", () => {
    expect(deploy.permissions).toEqual({ contents: "read" });
    expect(build?.permissions).toBeUndefined();
    expect(job?.permissions).toEqual({ contents: "read", pages: "write", "id-token": "write" });
    expect(DEPLOY_TEXT.match(/pages: write/g)).toHaveLength(1);
    expect(DEPLOY_TEXT.match(/id-token: write/g)).toHaveLength(1);
  });

  test("T7 the deploy job uses the github-pages environment", () => {
    expect(job?.environment?.name).toBe("github-pages");
    expect(job?.environment?.url).toBe("${{ steps.deployment.outputs.page_url }}");
    expect(build?.environment).toBeUndefined();
  });

  test("only the deploy job is in the pages group, and a run never cancels another", () => {
    expect(job?.concurrency).toEqual({ group: "pages", "cancel-in-progress": false });
    expect(build?.concurrency).toBeUndefined();
    expect((deploy as unknown as Record<string, unknown>).concurrency).toBeUndefined();
  });

  test("the gate step has no continue-on-error and no if", () => {
    expect(gate).toBeDefined();
    expect(gate).not.toHaveProperty("continue-on-error");
    expect(gate).not.toHaveProperty("if");
    for (const j of Object.values(deploy.jobs)) expect(j).not.toHaveProperty("continue-on-error");
  });

  test("the header comment says a pushed release tag starts it and the deploy fails red until O1", () => {
    expect(DEPLOY_TEXT).toContain("# A pushed release tag starts this workflow.");
    expect(DEPLOY_TEXT).toContain("the deploy job fails red");
    expect(DEPLOY_TEXT).not.toContain("does not run until the owner starts it");
  });

  test("the build job fetches the full history and sets up Bun and Node as ci.yml", () => {
    const list = steps(build);
    expect(list[0]).toMatchObject({ uses: "actions/checkout@v4", with: { "fetch-depth": 0 } });
    expect(list[1]).toMatchObject({ uses: "oven-sh/setup-bun@v2", with: { "bun-version-file": ".bun-version" } });
    expect(list[2]).toMatchObject({ uses: "actions/setup-node@v4", with: { "node-version": 24 } });
    expect(list[3]?.run).toBe("bun install --frozen-lockfile");
  });

  test("the gate gets the github context as env and the tags on stdin, and runs after the install", () => {
    expect(gate?.env).toEqual({
      GATE_EVENT: "${{ github.event_name }}",
      GATE_REF_TYPE: "${{ github.ref_type }}",
      GATE_REF_NAME: "${{ github.ref_name }}",
    });
    expect(gate?.run).toBe("git tag --list 'v*' | bun apps/docs/scripts/deploy-gate.ts");
    // A pipe needs pipefail (the `bash` shell of Actions sets it): a failed `git tag` must fail the step.
    expect(gate?.shell).toBe("bash");
    const list = steps(build);
    expect(list.indexOf(gate as Step)).toBeGreaterThan(
      list.findIndex((step) => step.run === "bun install --frozen-lockfile")
    );
    // The context never enters a script text.
    for (const step of list) expect(step.run ?? "").not.toContain("${{");
  });

  test("the build job exports the gate output and the deploy job needs it", () => {
    expect(build?.outputs).toEqual({ deploy: "${{ steps.gate.outputs.deploy }}" });
    expect(job?.needs).toBe("build");
    expect(job?.if).toBe("needs.build.outputs.deploy == 'true'");
  });

  test("every step after the gate runs only with deploy=true", () => {
    const list = steps(build);
    const after = list.slice(list.indexOf(gate as Step) + 1);
    expect(after.length).toBe(3);
    for (const step of after) expect(step.if).toBe("steps.gate.outputs.deploy == 'true'");
  });

  test("the strict stale check comes before the build, the build before the upload", () => {
    const list = steps(build);
    const stale = list.findIndex((step) => step.run === "bun run docs:stale --strict");
    const site = list.findIndex((step) => step.run === "bun run docs:build");
    const upload = list.findIndex((step) => step.uses?.startsWith("actions/upload-pages-artifact@"));
    expect(stale).toBeGreaterThan(list.indexOf(gate as Step));
    expect(site).toBeGreaterThan(stale);
    expect(upload).toBeGreaterThan(site);
  });

  test("the build gets the tag of a tag push and the commit of a manual run as DOCS_GIT_REF", () => {
    expect(run(build, "bun run docs:build")?.env).toEqual({
      DOCS_GIT_REF: "${{ github.event_name == 'push' && github.ref_name || github.sha }}",
    });
  });

  test("the artifact is apps/docs/dist and the deploy step takes it", () => {
    const upload = steps(build).find((step) => step.uses?.startsWith("actions/upload-pages-artifact@"));
    expect(upload?.uses).toBe("actions/upload-pages-artifact@v5");
    expect(upload?.with).toEqual({ path: "apps/docs/dist" });
    expect(steps(job)).toEqual([{ id: "deployment", uses: "actions/deploy-pages@v5" }]);
  });

  test("every action is pinned to a major, and a shared one has the version of ci.yml", () => {
    const shared = new Set(usesOf(ci));
    for (const uses of usesOf(deploy)) {
      expect(uses).toMatch(/^[\w-]+\/[\w-]+@v\d+$/);
      if (!uses.startsWith("actions/upload-pages-artifact") && !uses.startsWith("actions/deploy-pages")) {
        expect(shared.has(uses)).toBe(true);
      }
    }
  });

  test("it holds no secret, no env file and no token of its own", () => {
    for (const text of [DEPLOY_TEXT, JSON.stringify(ci.jobs.docs)]) {
      expect(text).not.toMatch(/secrets\./);
      expect(text).not.toMatch(/\.env\b/);
      expect(text).not.toMatch(/GITHUB_TOKEN|ACTIONS_RUNTIME_TOKEN/);
    }
    expect(CI_TEXT).not.toMatch(/secrets\./);
  });
});
