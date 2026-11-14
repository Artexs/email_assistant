import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  blindBatchFileSchema,
  miniScenario,
  planBank,
  type CaseText,
  type SimPart,
  type Slot,
  valueCategories,
} from "@ea/core";
import { afterEach, describe, expect, test } from "bun:test";

import {
  corpusDir,
  readLabels,
  readScenario,
  readSlots,
  readTexts,
  SimFileError,
  writeJson,
  writeSlots,
} from "./sim-files";
import {
  createMiniCorpus,
  fixtureText,
  miniPlanSpec,
  runSimCli,
  runSimInProcess,
  type MiniCorpus,
} from "./sim-fixtures.test-helper";

let corpus: MiniCorpus | undefined;
afterEach(() => {
  corpus?.cleanup();
  corpus = undefined;
});

async function planned(): Promise<MiniCorpus> {
  corpus = await createMiniCorpus({ plan: true });
  return corpus;
}

const sim = (c: MiniCorpus, ...args: string[]) => runSimInProcess([...args, "--root", c.root]);

function slotsOf(c: MiniCorpus, part: SimPart, batch: string): Slot[] {
  return readSlots(c.dir, part).filter((slot) => slot.batch === batch);
}

function writeTexts(c: MiniCorpus, part: SimPart, batch: string, texts: CaseText[]): void {
  writeJson(join(c.dir, part, "texts", `${batch}.json`), {
    scenario: "mini",
    part,
    batch,
    writer: "fixture",
    cases: texts,
  });
}

// All 25 slots of dev batch 1 with a clean text.
function writeCleanBatch(c: MiniCorpus): { slots: Slot[]; texts: CaseText[] } {
  const slots = slotsOf(c, "dev", "batch-001");
  const texts = slots.map((slot) => fixtureText(slot));
  writeTexts(c, "dev", "batch-001", texts);
  return { slots, texts };
}

describe("file layer", () => {
  test("writeJson writes 2-space JSON with a final newline and creates the folder", async () => {
    corpus = await createMiniCorpus();
    const path = join(corpus.dir, "deep", "x.json");
    writeJson(path, { a: [1] });
    expect(readFileSync(path, "utf8")).toBe('{\n  "a": [\n    1\n  ]\n}\n');
  });

  test("writeSlots groups slots by batch; readSlots reads them back in order", async () => {
    corpus = await createMiniCorpus();
    const { dev } = planBank(miniScenario, miniPlanSpec);
    const paths = writeSlots(corpus.dir, "dev", dev);
    expect(paths.map((p) => p.slice(-14))).toEqual(["batch-001.json", "batch-002.json"]);
    expect(readSlots(corpus.dir, "dev")).toEqual(dev);
    expect(readTexts(corpus.dir, "dev").size).toBe(0);
    expect(readLabels(corpus.dir, "dev").size).toBe(0);
  });

  test("a bad file throws a path and issue codes, never file content", async () => {
    corpus = await createMiniCorpus();
    writeFileSync(join(corpus.dir, "scenario.json"), JSON.stringify({ id: "mini", secretText: "do-not-print" }));
    let message = "";
    try {
      readScenario(corpus.dir);
    } catch (error) {
      expect(error).toBeInstanceOf(SimFileError);
      message = (error as Error).message;
    }
    expect(message).toContain("scenario.json");
    expect(message).not.toContain("do-not-print");
    expect(corpusDir("lab-01", "/tmp/x")).toBe("/tmp/x/lab-01");
  });
});

describe("plan and status", () => {
  test("1 plan writes the three parts and history; a second plan needs --force and rewrites identical files", async () => {
    corpus = await createMiniCorpus();
    const first = await sim(corpus, "plan", "mini");
    expect(first.code).toBe(0);
    expect(first.stdout).toMatch(/^part dev slots \d+ batches 2$/m);
    expect(first.stdout).toMatch(/^part holdout slots \d+ batches \d+$/m);
    expect(first.stdout).toMatch(/^part week slots \d+ batches \d+$/m);
    expect(existsSync(join(corpus.dir, "week", "history.json"))).toBe(true);

    const snapshot = () =>
      ["dev", "holdout", "week"].flatMap((part) =>
        readdirSync(join((corpus as MiniCorpus).dir, part, "slots")).map((f) =>
          readFileSync(join((corpus as MiniCorpus).dir, part, "slots", f), "utf8")
        )
      );
    const before = snapshot();
    const history = readFileSync(join(corpus.dir, "week", "history.json"), "utf8");
    const again = await sim(corpus, "plan", "mini");
    expect(again.code).toBe(1);
    expect(again.stdout).toContain("slots exist: use --force");
    expect((await sim(corpus, "plan", "mini", "--force")).code).toBe(0);
    expect(snapshot()).toEqual(before);
    expect(readFileSync(join(corpus.dir, "week", "history.json"), "utf8")).toBe(history);
  });

  test("2 plan --force is refused once a texts file exists", async () => {
    const c = await planned();
    writeCleanBatch(c);
    const result = await sim(c, "plan", "mini", "--force");
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("texts exist: re-plan not allowed");
  });

  test("3 status after plan counts the slots and writes nothing", async () => {
    const c = await planned();
    const bank = planBank(miniScenario, miniPlanSpec);
    const result = await sim(c, "status", "mini");
    expect(result.code).toBe(0);
    for (const [part, slots] of [
      ["dev", bank.dev],
      ["holdout", bank.holdout],
    ] as const) {
      for (const category of valueCategories) {
        const n = slots.filter((slot) => slot.category === category).length;
        expect(result.stdout).toContain(
          `part ${part} category ${category} slots ${n} written 0 dropped 0 labelled 0 agree 0 disagree 0 borderline 0`
        );
      }
    }
    expect(result.stdout).toMatch(/^part dev tag html_only slots 1 written 0$/m);
    expect(result.stdout).toMatch(/^total slots \d+ written 0 /m);
  });

  test("4 the script prints the usage and exits 1 for an unknown command or a missing --root value", () => {
    const unknown = runSimCli(["frobnicate", "mini"]);
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toContain("usage:");
    const noValue = runSimCli(["plan", "mini", "--root"]);
    expect(noValue.code).toBe(1);
    expect(noValue.stderr).toContain("usage:");
  });
});

describe("brief", () => {
  test("prints the facts of one batch: scenario, the personas it uses, delegates, slots", async () => {
    const c = await planned();
    const result = await sim(c, "brief", "mini", "--part", "dev", "--batch", "001");
    expect(result.code).toBe(0);
    const out = JSON.parse(result.stdout) as {
      scenario: { company: unknown; topics: unknown[] };
      personas: { key: string; signature: string; voice: string }[];
      delegates: { persona: string; name: string }[];
      slots: Slot[];
    };
    expect(out.slots).toHaveLength(25);
    expect(out.delegates.map((d) => d.persona)).toEqual(["anna", "marek"]);
    // The executive is in `scenario`, not in the persona list.
    const used = new Set(out.slots.flatMap((slot) => [slot.persona, ...slot.thread.map((t) => t.persona)]));
    used.delete(miniScenario.executive.key);
    expect(out.personas.map((p) => p.key).sort()).toEqual([...used].sort());
    expect((await sim(c, "brief", "mini", "--part", "dev", "--batch", "009")).code).toBe(1);
  });
});

describe("check", () => {
  test("1 clean texts give ok and exit 0", async () => {
    const c = await planned();
    writeCleanBatch(c);
    const result = await sim(c, "check", "mini", "--part", "dev", "--batches", "1-1");
    expect(result.stdout).toBe("ok\n");
    expect(result.code).toBe(0);
  });

  test("2 a phone number is a code line and never printed", async () => {
    const c = await planned();
    const { texts } = writeCleanBatch(c);
    const first = texts[0] as CaseText;
    writeTexts(c, "dev", "batch-001", [{ ...first, body: `${first.body}\ntel. 600 700 800` }, ...texts.slice(1)]);
    const result = await sim(c, "check", "mini", "--part", "dev", "--batches", "1-1");
    expect(result.code).toBe(1);
    expect(result.stdout).toContain(`case ${first.id} phone_number`);
    expect(result.stdout).toMatch(/issues \d+/);
    expect(result.stdout.includes("600")).toBe(false);
  });

  test("3 a text for an unknown slot and a slot with no text", async () => {
    const c = await planned();
    const { texts } = writeCleanBatch(c);
    const [dropped, ...rest] = texts as [CaseText, ...CaseText[]];
    writeTexts(c, "dev", "batch-001", [...rest, { ...dropped, id: "b-zzz-9999" }]);
    const result = await sim(c, "check", "mini", "--part", "dev", "--batches", "1-1");
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("case b-zzz-9999 slot_unknown");
    expect(result.stdout).toContain(`case ${dropped.id} text_missing`);
  });

  test("the spread check runs once every slot of the part has a text", async () => {
    const c = await planned();
    for (const batch of ["batch-001", "batch-002"]) {
      writeTexts(
        c,
        "dev",
        batch,
        slotsOf(c, "dev", batch).map((slot) => fixtureText(slot))
      );
    }
    expect((await sim(c, "check", "mini", "--part", "dev")).stdout).toBe("ok\n");
    for (const batch of ["batch-001", "batch-002"]) {
      writeTexts(
        c,
        "dev",
        batch,
        slotsOf(c, "dev", batch).map((slot) => fixtureText({ ...slot, style: { ...slot.style, length: "long" } }))
      );
    }
    expect((await sim(c, "check", "mini", "--part", "dev")).stdout).toMatch(/^spread dev length_share \d+/m);
  });

  test("a range with no texts says so and exits 1; an invalid file names its path", async () => {
    const c = await planned();
    expect(await sim(c, "check", "mini", "--part", "dev", "--batches", "1-2")).toMatchObject({
      code: 1,
      stdout: "nothing written in range\n",
    });
    mkdirSync(join(c.dir, "dev", "texts"), { recursive: true });
    writeFileSync(join(c.dir, "dev", "texts", "batch-001.json"), JSON.stringify({ cases: "do-not-print" }));
    const result = await sim(c, "check", "mini", "--part", "dev", "--batches", "1-1");
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("dev/texts/batch-001.json");
    expect(result.stdout).not.toContain("do-not-print");
  });
});

describe("blind view and labels", () => {
  test("4 blind-export writes a file that parses and holds no slot field", async () => {
    const c = await planned();
    writeCleanBatch(c);
    const result = await sim(c, "blind-export", "mini", "--part", "dev", "--batches", "1-1");
    expect(result.code).toBe(0);
    const raw = readFileSync(join(c.dir, "dev", "blind", "batch-001.json"), "utf8");
    const blind = blindBatchFileSchema.parse(JSON.parse(raw));
    expect(blind.cases).toHaveLength(25);
    for (const key of ["category", "urgencySource", "brief", "expectedDelegate", "hardCases"]) {
      expect(raw.includes(key)).toBe(false);
    }
    expect(blind.cases[0]?.from).toMatch(/^.+ <.+@.+>$/);
  });

  test("an html_only text reaches the blind view as the text the pipeline reads", async () => {
    const c = await planned();
    const part = (["dev", "holdout"] as const).find((p) =>
      readSlots(c.dir, p).some((s) => s.hardCases.includes("html_only"))
    );
    const slot = readSlots(c.dir, part ?? "dev").find((s) => s.hardCases.includes("html_only")) as Slot;
    writeTexts(c, slot.part, slot.batch, [fixtureText(slot)]);
    expect(
      (
        await sim(
          c,
          "blind-export",
          "mini",
          "--part",
          slot.part,
          "--batches",
          `${Number(slot.batch.slice(6))}-${Number(slot.batch.slice(6))}`
        )
      ).code
    ).toBe(0);
    const blind = blindBatchFileSchema.parse(
      JSON.parse(readFileSync(join(c.dir, slot.part, "blind", `${slot.batch}.json`), "utf8"))
    );
    expect(blind.cases[0]?.body).toContain(`Sprawa ${slot.id}`);
  });

  test("5 a disagreement, a rewrite (stale, round 2) and a borderline note", async () => {
    const c = await planned();
    const { slots, texts } = writeCleanBatch(c);
    const wrong = slots[0] as Slot;
    const other = valueCategories.find((category) => category !== wrong.category);
    const labelFile = (ids: Slot[], bad: boolean) =>
      JSON.stringify(ids.map((s) => ({ id: s.id, category: bad && s.id === wrong.id ? other : s.category })));
    expect((await sim(c, "blind-export", "mini", "--part", "dev", "--batches", "1-1")).code).toBe(0);
    writeFileSync(join(c.root, "labels.json"), labelFile(slots, true));
    const imported = await sim(
      c,
      "label-import",
      "mini",
      "--part",
      "dev",
      "--batch",
      "1",
      "--checker",
      "haiku",
      "--file",
      join(c.root, "labels.json")
    );
    expect(imported.code).toBe(0);
    const range = ["--part", "dev", "--batches", "1-1"];
    expect((await sim(c, "reconcile", "mini", ...range)).stdout).toBe(
      `disagree ${wrong.id} slot ${wrong.category} blind ${other} round 1\n`
    );
    expect((await sim(c, "stale", "mini", ...range)).stdout).toBe("");
    expect((await sim(c, "check", "mini", ...range)).stdout).toBe("ok\n");

    const first = texts[0] as CaseText;
    const rewrite = (patch: Partial<CaseText>) =>
      writeTexts(c, "dev", "batch-001", [{ ...first, ...patch }, ...texts.slice(1)]);
    rewrite({ body: `${first.body}\nTo jest nowe zdanie, ale nie ma w nim nic więcej.`, note: "rewritten: clearer" });
    expect((await sim(c, "blind-export", "mini", ...range)).code).toBe(0);
    expect((await sim(c, "stale", "mini", ...range)).stdout).toBe(`stale ${wrong.id}\n`);
    expect((await sim(c, "reconcile", "mini", ...range)).stdout).toBe("");
    const stale = await sim(c, "check", "mini", ...range);
    expect(stale.code).toBe(1);
    expect(stale.stdout).toContain(`case ${wrong.id} label_stale`);

    writeFileSync(join(c.root, "again.json"), JSON.stringify([{ id: wrong.id, category: other }]));
    expect(
      (
        await sim(
          c,
          "label-import",
          "mini",
          "--part",
          "dev",
          "--batch",
          "1",
          "--checker",
          "haiku",
          "--file",
          join(c.root, "again.json")
        )
      ).code
    ).toBe(0);
    expect((await sim(c, "reconcile", "mini", ...range)).stdout).toBe(
      `disagree ${wrong.id} slot ${wrong.category} blind ${other} round 2\n`
    );
    // The import replaced one label and kept the other 24.
    expect(readLabels(c.dir, "dev").size).toBe(25);

    rewrite({ body: `${first.body}\nTo jest nowe zdanie, ale nie ma w nim nic więcej.`, note: "borderline: both fit" });
    expect((await sim(c, "reconcile", "mini", ...range)).stdout).toBe("");
  });

  test("6 two blind-exports with no text change give the same file and no stale label", async () => {
    const c = await planned();
    const { slots } = writeCleanBatch(c);
    const range = ["--part", "dev", "--batches", "1-1"];
    const path = join(c.dir, "dev", "blind", "batch-001.json");
    expect((await sim(c, "blind-export", "mini", ...range)).code).toBe(0);
    const first = readFileSync(path, "utf8");
    writeFileSync(join(c.root, "labels.json"), JSON.stringify(slots.map((s) => ({ id: s.id, category: s.category }))));
    expect(
      (
        await sim(
          c,
          "label-import",
          "mini",
          "--part",
          "dev",
          "--batch",
          "1",
          "--checker",
          "haiku",
          "--file",
          join(c.root, "labels.json")
        )
      ).code
    ).toBe(0);
    expect((await sim(c, "blind-export", "mini", ...range)).code).toBe(0);
    expect(readFileSync(path, "utf8")).toBe(first);
    expect((await sim(c, "stale", "mini", ...range)).stdout).toBe("");
    expect((await sim(c, "reconcile", "mini", ...range)).stdout).toBe("");
    const status = (await sim(c, "status", "mini")).stdout;
    expect(status).toMatch(/^total slots \d+ written 25 dropped 0 labelled 25 agree 25 disagree 0 borderline 0$/m);
  });

  test("label-import refuses an id with no blind entry and writes nothing", async () => {
    const c = await planned();
    writeCleanBatch(c);
    writeFileSync(join(c.root, "labels.json"), JSON.stringify([{ id: "b-zzz-9999", category: "info" }]));
    const result = await sim(
      c,
      "label-import",
      "mini",
      "--part",
      "dev",
      "--batch",
      "1",
      "--checker",
      "haiku",
      "--file",
      join(c.root, "labels.json")
    );
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("label_unknown b-zzz-9999");
    expect(existsSync(join(c.dir, "dev", "labels"))).toBe(false);
  });
});
