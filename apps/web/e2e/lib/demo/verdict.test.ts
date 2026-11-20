import { describe, expect, test } from "bun:test";

import { modelCheck, uploadVerdict, type VerdictInput } from "./verdict";

const PERFECT: VerdictInput = {
  source: "demo",
  exitCode: 0,
  seedDay: 5,
  gateProvisional: false,
  misses: 0,
  notLive: [],
  llmChecked: true,
};
const NOT = "not for upload: ";

describe("uploadVerdict", () => {
  test.each<[string, Partial<VerdictInput>, string]>([
    ["perfect run", {}, "demo_source demo: upload candidate"],
    ["day 7 seed", { seedDay: 7 }, "demo_source demo: upload candidate"],
    ["failed run with perfect values", { exitCode: 1 }, `${NOT}run_failed`],
    ["day 4 seed", { seedDay: 4 }, `${NOT}trial_seed`],
    ["day 1 seed and provisional gate", { seedDay: 1, gateProvisional: true }, `${NOT}trial_seed`],
    ["no seed day", { seedDay: null }, `${NOT}trial_seed`],
    ["provisional gate", { gateProvisional: true }, `${NOT}gate_provisional`],
    ["two replay misses", { misses: 2 }, `${NOT}replay_miss`],
    ["model hosts not checked", { llmChecked: false }, `${NOT}llm_unchecked`],
    ["one step not live", { notLive: ["shadow"] }, `${NOT}not_live`],
    ["e2e source", { source: "e2e", seedDay: null, notLive: ["shadow", "report", "urgent"] }, `${NOT}e2e_source`],
    ["failed e2e run", { source: "e2e", exitCode: 1, seedDay: null }, `${NOT}run_failed`],
  ])("%s", (_name, change, expected) => {
    expect(uploadVerdict({ ...PERFECT, ...change })).toBe(expected);
  });
});

describe("modelCheck", () => {
  const own = `{"time":"t","level":"info","module":"start","event":"llm_settings","provider":"own","model":"m","endpoint":"own","host":"127.0.0.1"}`;
  const other = own.replace("127.0.0.1", "api.example.com");
  const text = "[WebServer] llm_settings provider=own model=m endpoint=own host=127.0.0.1";
  const noise = "[WebServer] job_scheduled job=trust.regate";

  test.each<[string, string[], number, string | null]>([
    ["two own lines on loopback, all hits", [own, noise, own], 27, null],
    ["a text line with a prefix", [text], 27, null],
    ["one hit short", [own, own], 26, "demo_llm_unchecked"],
    ["one line with another host", [own, other], 27, "demo_llm_unchecked"],
    [
      "a line with another endpoint kind",
      [own.replace('"endpoint":"own"', '"endpoint":"vendor"')],
      27,
      "demo_llm_unchecked",
    ],
    ["no settings line", [noise], 27, "demo_llm_unchecked"],
  ])("%s", (_name, lines, hits, expected) => {
    expect(modelCheck({ lines, hits, expectedHits: 27 })).toBe(expected);
  });
});
