import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { SHOTS } from "../src/shots";

// Stage 11, T2 and T3 on the real build: one fixture page uses <Shot> (a test fixture, not a real page). Each case runs the docs build into a
// folder of its own (on the device of the build, not /tmp: Astro renames files into it), so `dist` stays as it was. The fixture file is in `src/content/docs` for the time of the tests and is removed after.
const DOCS = join(import.meta.dir, "..");
// Ignored by git (`.gitignore`).
const WORK_ROOT = join(DOCS, "dist-shots-test");
const PUBLIC_SHOTS = join(DOCS, "public/shots");
const created: string[] = [];
const FIXTURE = join(DOCS, "src/content/docs/zz-shot-fixture.mdx");
// With `DOCS_SHOTS=on` every page with a `<Shot />` line needs its files, also the real pages of the tutorial and the guides (stage 12), and the
// Polish fallback of the fixture page needs the Polish ones: a build test that checks one page therefore starts from all 20 files of `SHOTS`.
// One docs build takes 4 to 15 seconds.
setDefaultTimeout(60_000);
let work = "";

function fixturePage(shot: string): string {
  return `---\ntitle: Shot fixture\ndescription: A fixture page for the shot build tests. Never committed.\n---\n\nimport Shot from "../../components/Shot.astro";\n\nText before.\n\n${shot}\n\nText after.\n`;
}

// A folder with the file of each shot of `SHOTS` except the names in `skip` (empty files: only the existence is checked).
function shotsFolder(name: string, skip: string[] = []): string {
  const dir = join(work, name);
  mkdirSync(dir);
  for (const shot of SHOTS) if (!skip.includes(shot.name)) writeFileSync(join(dir, `${shot.name}.png`), "png");
  return dir;
}

function build(
  name: string,
  shot: string,
  env: Record<string, string | undefined>
): { code: number; log: string; out: string } {
  writeFileSync(FIXTURE, fixturePage(shot));
  const out = join(work, `dist-${name}`);
  const run = Bun.spawnSync(["bun", "run", "build", "--outDir", out], {
    cwd: DOCS,
    // `bun test` sets NODE_ENV=test, and the Starlight bundle then differs (the allow list of the public-content check misses its credits).
    env: { ...process.env, NODE_ENV: "production", DOCS_SHOTS: undefined, EA_DOCS_SHOTS_DIR: undefined, ...env },
    timeout: 100_000,
  });
  return { code: run.exitCode ?? -1, log: `${run.stdout.toString()}${run.stderr.toString()}`, out };
}

beforeAll(() => {
  mkdirSync(WORK_ROOT, { recursive: true });
  work = mkdtempSync(join(WORK_ROOT, "run-"));
});
afterAll(() => {
  rmSync(FIXTURE, { force: true });
  rmSync(WORK_ROOT, { recursive: true, force: true });
  for (const file of created) rmSync(file, { force: true });
  // The folder goes only when it is empty (a shot run may have filled it).
  try {
    rmdirSync(PUBLIC_SHOTS);
  } catch {
    // not empty, or not there
  }
});

describe("<Shot> in the docs build", () => {
  test("T2: DOCS_SHOTS=on with no shot file fails with shot_missing", () => {
    // 19 of the 20 files: the build names the one that is missing (a real page with the same shot fails with the same name).
    const dir = shotsFolder("missing", ["settings-en-desktop"]);
    const result = build("missing", `<Shot page="settings" />`, { DOCS_SHOTS: "on", EA_DOCS_SHOTS_DIR: dir });
    expect(result.code).not.toBe(0);
    expect(result.log).toContain("shot_missing settings-en-desktop");
    expect(result.log).not.toContain("shot_missing onboarding");
    expect(result.log).toContain("shots: on");
  });

  test("T3: DOCS_SHOTS unset passes, logs `shots: off` once and shows a box with the alt text", () => {
    const result = build("off", `<Shot page="settings" />`, {});
    expect(result.code).toBe(0);
    expect(result.log.match(/shots: off/g)?.length).toBe(1);
    const html = readFileSync(join(result.out, "zz-shot-fixture/index.html"), "utf8");
    expect(html).toContain(`class="shot-off"`);
    expect(html).toContain("The Settings page of the panel");
    expect(html).not.toContain("<picture");
    expect(readFileSync(join(result.out, "pl/zz-shot-fixture/index.html"), "utf8")).toContain(
      "Strona Ustawienia w panelu"
    );
  });

  test("DOCS_SHOTS=on with the files passes: the desktop file in the image, the phone file in a <picture> source", () => {
    // The real folder `public/shots` (the integration's default): the link check needs the files in the built site.
    // A file that a shot run left there stays; the test writes and removes only its own.
    mkdirSync(PUBLIC_SHOTS, { recursive: true });
    // The page of the fixture also builds as the Polish fallback `/pl/…`, and the real pages show other panel pages: all 20 files.
    for (const { name } of SHOTS) {
      const file = join(PUBLIC_SHOTS, `${name}.png`);
      if (existsSync(file)) continue;
      writeFileSync(file, "png");
      created.push(file);
    }
    const result = build("on", `<Shot page="settings" />`, { DOCS_SHOTS: "on" });
    expect(result.code).toBe(0);
    expect(result.log.match(/shots: on/g)?.length).toBe(1);
    const html = readFileSync(join(result.out, "zz-shot-fixture/index.html"), "utf8");
    expect(html).toContain(`<source media="(max-width: 600px)" srcset="/email_assistant/shots/settings-en-phone.png"`);
    expect(html).toContain(`src="/email_assistant/shots/settings-en-desktop.png"`);
    expect(html).not.toContain("shot-off");
    expect(existsSync(join(result.out, "shots/settings-en-desktop.png"))).toBe(true);
    // A real page builds with its images too: the tutorial shows the Onboarding page (English and Polish).
    const tutorial = readFileSync(join(result.out, "start/index.html"), "utf8");
    expect(tutorial).toContain(`src="/email_assistant/shots/onboarding-en-desktop.png"`);
    expect(readFileSync(join(result.out, "pl/start/index.html"), "utf8")).toContain(
      `src="/email_assistant/shots/onboarding-pl-desktop.png"`
    );
    for (const { name } of SHOTS) expect(existsSync(join(result.out, `shots/${name}.png`))).toBe(true);
  });

  test("an unknown page fails the build with the shots on and off", () => {
    // With the shots on, the real pages need their files first: the folder holds all 20, so the build reaches the fixture page.
    const dir = shotsFolder("all");
    for (const env of [{}, { DOCS_SHOTS: "on", EA_DOCS_SHOTS_DIR: dir }]) {
      const result = build("unknown", `<Shot page="nope" />`, env);
      expect(result.code).not.toBe(0);
      expect(result.log).toContain("shot_unknown_page nope");
      expect(result.log).not.toContain("shot_missing");
    }
  });
});
