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
  needs?: string | string[];
  if?: string;
  uses?: string;
  with?: Record<string, unknown>;
  secrets?: unknown;
  env?: Record<string, string>;
  "runs-on"?: string;
  services?: unknown;
  permissions?: Record<string, string>;
  environment?: { name?: string; url?: string };
  concurrency?: { group?: string; "cancel-in-progress"?: boolean };
  outputs?: Record<string, string>;
  steps?: Step[];
}
interface Workflow {
  on: { push?: { tags?: string[]; branches?: string[] }; workflow_dispatch?: unknown; workflow_call?: unknown };
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

  test("it installs Chromium and runs the browser check after the build, and keeps the results on failure", () => {
    const list = steps(docs);
    const commands = list.map((step) => step.run);
    const build = commands.indexOf("bun run docs:build");
    const install = commands.indexOf("bunx playwright install --with-deps chromium");
    const check = commands.indexOf("bun run docs:test");
    expect(install).toBeGreaterThan(build);
    expect(check).toBeGreaterThan(install);
    for (const index of [install, check]) {
      expect(list[index]).not.toHaveProperty("continue-on-error");
      expect(list[index]).not.toHaveProperty("if");
    }
    const upload = list[check + 1];
    expect(upload?.uses).toBe("actions/upload-artifact@v4");
    expect(upload?.if).toBe("failure()");
    expect(upload?.with).toEqual({
      name: "docs-playwright-results",
      path: "apps/docs/e2e/test-results/",
      "retention-days": 7,
    });
    expect(list).toHaveLength(check + 2);
  });

  test("ci.yml can be called by the deploy workflow: every job of it then runs before the shots", () => {
    expect(ci.on.workflow_call).toEqual({});
    expect(ci.on.workflow_dispatch).toEqual({});
  });

  test("it runs on every push and pull request of the file's triggers", () => {
    expect(docs?.if).toBeUndefined();
  });
});

describe("docs-deploy.yml", () => {
  const gateJob = deploy.jobs.gate;
  const checks = deploy.jobs.checks;
  const build = deploy.jobs.build;
  const job = deploy.jobs.deploy;
  const gate = steps(gateJob).find((step) => step.id === "gate");
  const buildCommands = steps(build).map((step) => step.run);
  const buildIndex = (command: string) => buildCommands.indexOf(command);
  const uploadIndex = steps(build).findIndex((step) => step.uses?.startsWith("actions/upload-pages-artifact@"));

  test("T7 jobs are gate, checks, build and deploy", () => {
    expect(Object.keys(deploy.jobs).join(" ")).toBe("gate checks build deploy");
  });

  test("it runs on a v* tag push and by hand, with one boolean input that defaults to false", () => {
    expect(deploy.on.push).toEqual({ tags: ["v*"] });
    expect(deploy.on.workflow_dispatch).toMatchObject({
      inputs: { publish_held_pages: { type: "boolean", default: false } },
    });
    expect(Object.keys((deploy.on.workflow_dispatch as { inputs: object }).inputs)).toEqual(["publish_held_pages"]);
    expect(Object.keys(deploy.on).sort()).toEqual(["push", "workflow_dispatch"]);
  });

  test("T7 only the deploy job has pages: write and id-token: write", () => {
    expect(deploy.permissions).toEqual({ contents: "read" });
    expect(gateJob?.permissions).toBeUndefined();
    expect(build?.permissions).toBeUndefined();
    expect(checks?.permissions).toEqual({ contents: "read" });
    expect(job?.permissions).toEqual({ contents: "read", pages: "write", "id-token": "write" });
    expect(DEPLOY_TEXT.match(/pages: write/g)).toHaveLength(1);
    expect(DEPLOY_TEXT.match(/id-token: write/g)).toHaveLength(1);
  });

  test("T7 the deploy job uses the github-pages environment", () => {
    expect(job?.environment?.name).toBe("github-pages");
    expect(job?.environment?.url).toBe("${{ steps.deployment.outputs.page_url }}");
    for (const other of [gateJob, checks, build]) expect(other?.environment).toBeUndefined();
  });

  test("only the deploy job is in the pages group, and a run never cancels another", () => {
    expect(job?.concurrency).toEqual({ group: "pages", "cancel-in-progress": false });
    for (const other of [gateJob, checks, build]) expect(other?.concurrency).toBeUndefined();
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

  test("the gate job fetches the full history and sets up Bun and Node as ci.yml; the build job sets up the same", () => {
    for (const [j, depth] of [
      [gateJob, true],
      [build, false],
    ] as const) {
      const list = steps(j);
      expect(list[0]).toMatchObject({ uses: "actions/checkout@v4" });
      if (depth) expect(list[0]).toMatchObject({ with: { "fetch-depth": 0 } });
      expect(list[1]).toMatchObject({ uses: "oven-sh/setup-bun@v2", with: { "bun-version-file": ".bun-version" } });
      expect(list[2]).toMatchObject({ uses: "actions/setup-node@v4", with: { "node-version": 24 } });
      expect(list[3]?.run).toBe("bun install --frozen-lockfile");
    }
  });

  test("the gate gets the github context as env and the tags on stdin, and runs after the install", () => {
    expect(gate?.env).toEqual({
      GATE_EVENT: "${{ github.event_name }}",
      GATE_REF_TYPE: "${{ github.ref_type }}",
      GATE_REF_NAME: "${{ github.ref_name }}",
      GATE_PUBLISH_HELD: "${{ inputs.publish_held_pages }}",
    });
    expect(gate?.run).toBe("git tag --list 'v*' | bun apps/docs/scripts/deploy-gate.ts");
    // A pipe needs pipefail (the `bash` shell of Actions sets it): a failed `git tag` must fail the step.
    expect(gate?.shell).toBe("bash");
    const list = steps(gateJob);
    expect(list.indexOf(gate as Step)).toBeGreaterThan(
      list.findIndex((step) => step.run === "bun install --frozen-lockfile")
    );
    // The context never enters a script text.
    for (const j of Object.values(deploy.jobs))
      for (const step of steps(j)) expect(step.run ?? "").not.toContain("${{");
  });

  test("the gate job runs first and exports the output; every later job runs only with deploy=true", () => {
    expect(gateJob?.needs).toBeUndefined();
    expect(gateJob?.if).toBeUndefined();
    expect(gateJob?.outputs).toEqual({ deploy: "${{ steps.gate.outputs.deploy }}" });
    for (const j of [checks, build, job]) expect(j?.if).toBe("needs.gate.outputs.deploy == 'true'");
    expect(checks?.needs).toBe("gate");
    expect(job?.needs).toEqual(["gate", "build"]);
  });

  test("T4 the checks job calls ci.yml whole, with no input and no secret", () => {
    expect(checks?.uses).toBe("./.github/workflows/ci.yml");
    expect(checks?.with).toBeUndefined();
    expect(checks?.secrets).toBeUndefined();
    expect(checks).not.toHaveProperty("steps");
    expect(checks).not.toHaveProperty("continue-on-error");
  });

  test("T4 the build job needs the gate and the checks, so no shot is made before every check of CI passed", () => {
    expect(build?.needs).toEqual(["gate", "checks"]);
  });

  test("T4 the build job has the services and the env of the e2e job of ci.yml, the same images", () => {
    expect(Object.keys(build?.services as object).sort()).toEqual(["greenmail", "postgres"]);
    expect(build?.services).toEqual(ci.jobs.e2e?.services);
    expect(build?.env).toEqual(ci.jobs.e2e?.env);
    expect(build?.["runs-on"]).toBe("ubuntu-latest");
  });

  test("T4 the build job sets up as the e2e job, then stale, shots, build, browser check and the upload in this order", () => {
    const order = [
      "bun install --frozen-lockfile",
      "bun run docs:stale --strict",
      "bun run db:migrate",
      "bun run web:build",
      "bunx playwright install --with-deps chromium",
      "bun run docs:shots",
      "bun run docs:build",
      "bun run docs:test",
    ];
    const at = order.map((command) => buildIndex(command));
    for (const [index, command] of order.entries())
      expect({ command, found: at[index] !== -1 }).toEqual({ command, found: true });
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(uploadIndex).toBeGreaterThan(at[at.length - 1] as number);
    // The database roles, the e2e database and a random key come before the migration.
    const list = steps(build);
    const key = list.findIndex(
      (step) => step.run === 'echo "CREDENTIALS_KEY=$(openssl rand -base64 32)" >> "$GITHUB_ENV"'
    );
    const roles = list.findIndex(
      (step) => step.run?.includes("db/roles.sql") && step.run.includes("CREATE DATABASE email_assistant_e2e")
    );
    expect(key).toBeGreaterThan(-1);
    expect(roles).toBeGreaterThan(-1);
    expect(key).toBeLessThan(buildIndex("bun run db:migrate"));
    expect(roles).toBeLessThan(buildIndex("bun run db:migrate"));
    // The shot run needs the built panel and the browser.
    expect(buildIndex("bun run web:build")).toBeLessThan(buildIndex("bun run docs:shots"));
    expect(buildIndex("bunx playwright install --with-deps chromium")).toBeLessThan(buildIndex("bun run docs:shots"));
    expect(buildIndex("bun run docs:stale --strict")).toBeLessThan(buildIndex("bun run docs:shots"));
  });

  test("T4 no step of the build job is skipped or may fail, except the artifact of a failure", () => {
    for (const step of steps(build)) {
      expect(step).not.toHaveProperty("continue-on-error");
      if (step.uses?.startsWith("actions/upload-artifact@")) expect(step.if).toBe("failure()");
      else expect(step).not.toHaveProperty("if");
    }
  });

  test("T4 the site is built with the shots on, at the ref of the run", () => {
    expect(run(build, "bun run docs:build")?.env).toEqual({
      DOCS_SHOTS: "on",
      DOCS_GIT_REF: "${{ github.event_name == 'push' && github.ref_name || github.sha }}",
    });
    // Only this step turns the shots on: the shot run itself, the stale check and the browser check run without the variable.
    for (const step of steps(build))
      if (step.run !== "bun run docs:build") expect(step.env?.DOCS_SHOTS).toBeUndefined();
  });

  test("on a failure the results of both Playwright runs are kept for 7 days", () => {
    const upload = steps(build).find((step) => step.uses?.startsWith("actions/upload-artifact@"));
    expect(upload?.uses).toBe("actions/upload-artifact@v4");
    expect(upload?.with).toEqual({
      name: "docs-deploy-playwright-results",
      path: "apps/web/e2e/test-results/\napps/docs/e2e/test-results/\n",
      "retention-days": 7,
    });
    expect(steps(build).indexOf(upload as Step)).toBeLessThan(uploadIndex);
  });

  test("the artifact is apps/docs/dist, the last step of build, and the deploy step takes it", () => {
    const upload = steps(build)[uploadIndex];
    expect(upload?.uses).toBe("actions/upload-pages-artifact@v5");
    expect(upload?.with).toEqual({ path: "apps/docs/dist" });
    expect(uploadIndex).toBe(steps(build).length - 1);
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

  test("T5 it holds no secret, no env file and no token of its own, and the shot run uses only localhost services", () => {
    for (const text of [DEPLOY_TEXT, JSON.stringify(ci.jobs.docs)]) {
      expect(text).not.toMatch(/secrets\./);
      expect(text).not.toMatch(/\.env\b/);
      expect(text).not.toMatch(/GITHUB_TOKEN|ACTIONS_RUNTIME_TOKEN/);
    }
    expect(CI_TEXT).not.toMatch(/secrets\./);
    // No `secrets:` key (`secrets: inherit` passes every secret to the called workflow).
    expect(JSON.stringify(deploy.jobs)).not.toMatch(/secrets/);
    // The only hosts of the build job are the services of the job.
    const hosts = JSON.stringify(build?.env) + JSON.stringify(steps(build));
    const urls = [...hosts.matchAll(/@([\w.-]+):\d+/g)].map((match) => match[1]);
    expect(urls.length).toBeGreaterThan(0);
    for (const host of urls) expect(host).toBe("localhost");
  });
});
