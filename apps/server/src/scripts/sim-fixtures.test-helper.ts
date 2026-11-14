import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { miniPlanSpec, miniScenario, simParts, type CaseText, type Scenario, type Slot } from "@ea/core";

import { describeError } from "../platform/errors";

import { parseSimArgs, usage } from "./sim-args";
import { runSim } from "./sim-commands";
import { listBatches, readSlots, writeJson } from "./sim-files";

// Test helper of `bun run sim`: a corpus folder in a temp dir, planned from miniScenario and a small spec.

export { miniPlanSpec };

export interface MiniCorpus {
  // The folder that holds the corpus folder (the --root value).
  root: string;
  // The corpus folder `<root>/mini`.
  dir: string;
  cleanup(): void;
}

// Writes scenario.json and plan-spec.json; with `plan` it also runs `sim plan`.
export async function createMiniCorpus(options: { plan?: boolean } = {}): Promise<MiniCorpus> {
  const root = mkdtempSync(join(tmpdir(), "f097-sim-"));
  const dir = join(root, miniScenario.id);
  mkdirSync(dir, { recursive: true });
  writeJson(join(dir, "scenario.json"), miniScenario);
  writeJson(join(dir, "plan-spec.json"), miniPlanSpec);
  if (options.plan === true) {
    const cmd = parseSimArgs(["plan", miniScenario.id, "--root", root]);
    if (cmd === undefined) throw new Error("bad plan arguments");
    const result = await runSim(cmd);
    if (result.code !== 0) throw new Error("plan failed");
  }
  return { root, dir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const scriptPath = resolve(import.meta.dir, "sim.ts");

// Runs the real script as a child process: exit code, stdout and stderr.
export function runSimCli(args: string[]): { code: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync(["bun", scriptPath, ...args]);
  return { code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

// Runs the same steps as sim.ts in this process. A child process costs about 0.4 s of Bun start-up per call,
// and a test that runs the script a dozen times then needs about 4 s, near the 5 s default under load.
export async function runSimInProcess(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const cmd = parseSimArgs(args);
  if (cmd === undefined) return { code: 1, stdout: "", stderr: `${usage}\n` };
  try {
    const result = await runSim(cmd);
    const stdout = result.lines.length > 0 ? `${result.lines.join("\n")}\n` : "";
    return { code: result.code, stdout, stderr: "" };
  } catch (error) {
    return { code: 1, stdout: "", stderr: `sim failed: ${describeError(error)}\n` };
  }
}

const sentences: Record<string, string> = {
  pl: "Dzień dobry, to jest bardzo ważne, ale nie mam czasu, więc proszę o pomoc i dziękuję za wszystko.",
  en: "Hello, this is the note that we send to you, and we can write it for the team, please let me know when you are ready, thanks.",
  de: "Guten Tag, das ist nicht die Sache, die wir haben, und ich bitte Sie, mir die Antwort bis morgen zu schicken, danke.",
};
const WORDS = { short: 20, medium: 100, long: 220 } as const;

function filler(lang: string, words: number): string {
  const sentence = (sentences[lang] ?? sentences.en) as string;
  const all = Array.from({ length: Math.ceil(words / 10) }, () => sentence).join(" ");
  return all.split(/\s+/).slice(0, words).join(" ");
}

// A text that passes `checkCase` for the slot: right language, length, format, signature, thread and facts.
export function fixtureText(slot: Slot, scenario: Scenario = miniScenario): CaseText {
  const signature = scenario.personas.find((p) => p.key === slot.persona)?.signature ?? "";
  const planted = slot.kind === "injection" ? ["PL00-TEST-4821"] : [];
  const files = slot.attachments.map((a) => `Plik: ${a.name}`);
  const lines = [
    "Dzień dobry,",
    `Sprawa ${slot.id}: ${filler(slot.lang, WORDS[slot.style.length])}`,
    ...files,
    ...planted,
    ...(slot.style.signature && signature !== "" ? [signature] : []),
  ];
  const htmlOnly = slot.hardCases.includes("html_only");
  const body = lines.join("\n");
  const text: CaseText = {
    id: slot.id,
    subject: `Temat ${slot.id}`,
    body: htmlOnly ? "" : body,
    thread: slot.thread.map((item, i) => ({ subject: `Wątek ${i}`, body: filler(slot.lang, 12) })),
  };
  if (slot.style.format === "html" || htmlOnly) {
    text.html = `<div style="margin:0">${lines.map((line) => `<p>${line}</p>`).join("")}</div>`;
  }
  if (slot.category === "needs_reply") text.expectedPoints = ["Odpowiedz na pytanie"];
  if (planted.length > 0) text.planted = planted;
  return text;
}

async function runInProcess(args: string[]): Promise<void> {
  const result = await runSimInProcess(args);
  if (result.code !== 0) throw new Error(`${args[0]} failed: ${result.stdout.trim().split("\n").join(" | ")}`);
}

// A planned mini corpus with a clean text and a blind label (the slot category) for every case, so it can freeze.
async function writeCompleteCorpus(c: MiniCorpus): Promise<void> {
  for (const part of simParts) {
    const slots = readSlots(c.dir, part);
    const batches = listBatches(c.dir, part, "slots");
    for (const batch of batches) {
      writeJson(join(c.dir, part, "texts", `${batch}.json`), {
        scenario: miniScenario.id,
        part,
        batch,
        writer: "fixture",
        cases: slots.filter((slot) => slot.batch === batch).map((slot) => fixtureText(slot)),
      });
    }
    const range = ["--batches", `1-${batches.length}`];
    await runInProcess(["blind-export", miniScenario.id, "--part", part, ...range, "--root", c.root]);
    for (const batch of batches) {
      const labels = slots
        .filter((slot) => slot.batch === batch && slot.direction !== "sent")
        .map((slot) => ({ id: slot.id, category: slot.category }));
      const file = join(c.root, `labels-${part}-${batch}.json`);
      writeFileSync(file, JSON.stringify(labels));
      const n = String(Number(batch.slice("batch-".length)));
      await runInProcess([
        "label-import",
        miniScenario.id,
        "--part",
        part,
        "--batch",
        n,
        "--checker",
        "fixture",
        "--file",
        file,
        "--root",
        c.root,
      ]);
    }
  }
}

let template: Promise<MiniCorpus> | undefined;

// A copy of the complete corpus: it is built once per test file, then copied (the build is slow).
export async function completeCorpus(): Promise<MiniCorpus> {
  if (template === undefined) {
    template = createMiniCorpus({ plan: true }).then(async (c) => {
      await writeCompleteCorpus(c);
      process.on("exit", c.cleanup);
      return c;
    });
  }
  const source = await template;
  const root = mkdtempSync(join(tmpdir(), "f097-sim-"));
  cpSync(source.root, root, { recursive: true });
  return { root, dir: join(root, miniScenario.id), cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
