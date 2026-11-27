import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { publicContentScan } from "@ea/core/web";
import { SHOT_TEXT_ALLOW } from "../../../docs/src/shots";
import { E2E_BASE_URL } from "../env";
import { signIn } from "../helpers";
import { DEMO_STEPS, stepView, type DemoCue } from "../lib/demo/steps";
import { DEMO_VIDEO_SIZE, DEMO_VIEWPORT } from "../lib/demo/record-args";
import { shotSource } from "../lib/shot-source";
import { readSeed } from "../seed";
import { readDemoPlan, setupProblems } from "../lib/demo/setup";
import { runDemoSteps } from "./demo-steps";
import { runE2eSteps } from "./e2e-steps";
import { collectSetupState, readDemoOwner, signInOwner } from "./setup-run";
import type { StepKit } from "./steps-kit";

// The recording of the demo video (the public pages and demo ticket). One page records the whole video: the steps of `DEMO_STEPS` run in
// order, each as one owner of the e2e seed (README.md, the spike table), and the page switches between the panel and the read-only view
// of the fake Telegram. The sign-ins happen before the recording starts, in a context that records nothing: no password or sign-in form is
// in the video. The spec writes the cue times (ms from the video start) and the raw video to `DEMO_WORK_DIR`; the command encodes it.
test.describe.configure({ mode: "serial" });

const WORK_DIR = process.env.DEMO_WORK_DIR ?? "";
// A client address for each sign-in (the login rate limit counts per address): documentation range 192.0.2.0/24.
const ADDRESS = (n: number): string => `192.0.2.${230 + n}`;
// The API session of the demo waits (off camera): its own address, apart from the sign-ins above and those of `setup-run.ts`.
const API_ADDRESS = "192.0.2.222";

type Owner = "main" | "trust" | "approvals" | "delegations";

// What a viewer sees: the visible text and the values of the fields that are not secret.
async function pageText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const fields = [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")]
      .filter((field) => field.type !== "password")
      .map((field) => field.value);
    return [document.body.innerText, ...fields].join("\n");
  });
}

// The state check of the setup (`@setup`): as the owner, the demo organization is ready for the recording. `demo:record --setup-only` runs only
// this test. The e2e source has no demo setup, so the test skips there.
test("the demo setup left the organization ready for the recording @setup", async () => {
  test.skip(shotSource().kind !== "demo", "the e2e source has no demo setup");
  const planFile = process.env.DEMO_PLAN_FILE ?? "";
  if (planFile === "") throw new Error("demo_replay_missing: run bun run demo:record");
  const state = await collectSetupState(readDemoPlan(planFile), readDemoOwner());
  expect(setupProblems(state)).toEqual([]);
});

test("the demo recording follows the eight steps of the script @record", async ({ browser }) => {
  if (WORK_DIR === "") throw new Error("demo_work_dir_missing");
  const source = shotSource().kind;
  mkdirSync(WORK_DIR, { recursive: true });
  // The demo source has one organization and its owner; the e2e source signs in to four organizations of its seed.
  const owners: Partial<Record<Owner, { email: string; password: string }>> = (() => {
    if (source === "demo") return { main: readDemoOwner() };
    const seed = readSeed();
    const project = "desktop";
    return {
      main: seed.owner,
      trust: seed.trustOrgs[project].owner,
      approvals: seed.approvalsOrgs[project].owner,
      delegations: seed.delegationsOrgs[project].owner,
    };
  })();

  // eslint-disable-next-line no-console
  console.log("demo_signins start");
  // Sign-ins, off camera: one storage state for each owner.
  const states: Partial<Record<Owner, Awaited<ReturnType<BrowserContext["storageState"]>>>> = {};
  let at = 0;
  for (const name of Object.keys(owners) as Owner[]) {
    const account = owners[name];
    if (account === undefined) continue;
    at += 1;
    const login = await browser.newContext({
      baseURL: E2E_BASE_URL,
      viewport: { ...DEMO_VIEWPORT },
      extraHTTPHeaders: { "x-forwarded-for": ADDRESS(at) },
    });
    const loginPage = await login.newPage();
    await signIn(loginPage, account.email, account.password);
    await loginPage.waitForURL((url) => !url.pathname.startsWith("/login"));
    states[name] = await login.storageState();
    await login.close();
  }

  // The recording context. The panel reads the language key before the browser language (`apps/web/src/i18n/index.ts`).
  const context = await browser.newContext({
    baseURL: E2E_BASE_URL,
    viewport: { ...DEMO_VIEWPORT },
    locale: "en-US",
    recordVideo: { dir: join(WORK_DIR, "video"), size: { ...DEMO_VIDEO_SIZE } },
    extraHTTPHeaders: { "x-forwarded-for": ADDRESS(9) },
  });
  await context.addInitScript(() => localStorage.setItem("ea.locale", "en"));
  const page = await context.newPage();
  const startedAt = Date.now();
  const cues: DemoCue[] = [];

  async function become(name: Owner): Promise<void> {
    const state = states[name];
    if (state === undefined) throw new Error(`demo_signin_missing ${name}`);
    await context.clearCookies();
    await context.addCookies(state.cookies);
  }

  // Runs one step: `act` does the visible work. The page text then passes the public-content check. The step ends after its planned
  // `seconds`, never sooner: a longer `act` makes it longer. Work off camera runs between two steps, where the encode cuts the gap.
  async function step(id: string, act: () => Promise<void>): Promise<void> {
    const found = DEMO_STEPS.find((candidate) => candidate.id === id);
    const planned = found === undefined ? undefined : stepView(found, source);
    if (planned === undefined) throw new Error(`demo_unknown_step ${id}`);
    const startMs = Date.now() - startedAt;
    // eslint-disable-next-line no-console
    console.log(`demo_step ${id} start ${startMs} ms`);
    await act();
    const [problem] = publicContentScan(
      await pageText(page),
      SHOT_TEXT_ALLOW.map((entry) => entry.text)
    ).problems;
    if (problem !== undefined) throw new Error(`demo_public_content ${id} ${problem.rule} ${problem.match}`);
    const spent = Date.now() - startedAt - startMs;
    if (spent < planned.seconds * 1000) await page.waitForTimeout(planned.seconds * 1000 - spent);
    cues.push({ stepId: id, startMs, endMs: Date.now() - startedAt });
    // eslint-disable-next-line no-console
    console.log(`demo_step ${id} end ${Date.now() - startedAt} ms`);
  }

  const kit: StepKit = { page, become, step };
  if (source === "demo") {
    const planFile = process.env.DEMO_PLAN_FILE ?? "";
    if (planFile === "") throw new Error("demo_replay_missing: run bun run demo:record");
    await runDemoSteps(kit, readDemoPlan(planFile), await signInOwner(readDemoOwner(), API_ADDRESS));
  } else {
    await runE2eSteps(kit);
  }

  // Close the page first: the video file is complete only after that.
  const video = page.video();
  await page.close();
  await context.close();
  if (video === null) throw new Error("demo_video_missing");
  await video.saveAs(join(WORK_DIR, "raw.webm"));
  writeFileSync(join(WORK_DIR, "cues.json"), `${JSON.stringify(cues, null, 2)}\n`);
  expect(cues.map((cue) => cue.stepId)).toEqual(DEMO_STEPS.map((candidate) => candidate.id));
});
