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
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";

import {
  corpusDir,
  readLabels,
  readManifest,
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
  completeCorpus,
  type MiniCorpus,
} from "./sim-fixtures.test-helper";

// Each command of the script runs as a child process.
setDefaultTimeout(30_000);

let corpus: MiniCorpus | undefined;
afterEach(() => {
  corpus?.cleanup();
  corpus = undefined;
});

async function planned(): Promise<MiniCorpus> {
  corpus = await createMiniCorpus({ plan: true });
  return corpus;
}

const sim = (c: MiniCorpus, ...args: string[]) => runSimCli([...args, "--root", c.root]);

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
    const first = sim(corpus, "plan", "mini");
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
    const again = sim(corpus, "plan", "mini");
    expect(again.code).toBe(1);
    expect(again.stdout).toContain("slots exist: use --force");
    expect(sim(corpus, "plan", "mini", "--force").code).toBe(0);
    expect(snapshot()).toEqual(before);
    expect(readFileSync(join(corpus.dir, "week", "history.json"), "utf8")).toBe(history);
  });

  test("2 plan --force is refused once a texts file exists", async () => {
    const c = await planned();
    writeCleanBatch(c);
    const result = sim(c, "plan", "mini", "--force");
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("texts exist: re-plan not allowed");
  });

  test("3 status after plan counts the slots and writes nothing", async () => {
    const c = await planned();
    const bank = planBank(miniScenario, miniPlanSpec);
    const result = sim(c, "status", "mini");
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
    const result = sim(c, "brief", "mini", "--part", "dev", "--batch", "001");
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
    expect(sim(c, "brief", "mini", "--part", "dev", "--batch", "009").code).toBe(1);
  });
});

describe("check", () => {
  test("1 clean texts give ok and exit 0", async () => {
    const c = await planned();
    writeCleanBatch(c);
    const result = sim(c, "check", "mini", "--part", "dev", "--batches", "1-1");
    expect(result.stdout).toBe("ok\n");
    expect(result.code).toBe(0);
  });

  test("2 a phone number is a code line and never printed", async () => {
    const c = await planned();
    const { texts } = writeCleanBatch(c);
    const first = texts[0] as CaseText;
    writeTexts(c, "dev", "batch-001", [{ ...first, body: `${first.body}\ntel. 600 700 800` }, ...texts.slice(1)]);
    const result = sim(c, "check", "mini", "--part", "dev", "--batches", "1-1");
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
    const result = sim(c, "check", "mini", "--part", "dev", "--batches", "1-1");
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
    expect(sim(c, "check", "mini", "--part", "dev").stdout).toBe("ok\n");
    for (const batch of ["batch-001", "batch-002"]) {
      writeTexts(
        c,
        "dev",
        batch,
        slotsOf(c, "dev", batch).map((slot) => fixtureText({ ...slot, style: { ...slot.style, length: "long" } }))
      );
    }
    expect(sim(c, "check", "mini", "--part", "dev").stdout).toMatch(/^spread dev length_share \d+/m);
  });

  test("a range with no texts says so and exits 1; an invalid file names its path", async () => {
    const c = await planned();
    expect(sim(c, "check", "mini", "--part", "dev", "--batches", "1-2")).toMatchObject({
      code: 1,
      stdout: "nothing written in range\n",
    });
    mkdirSync(join(c.dir, "dev", "texts"), { recursive: true });
    writeFileSync(join(c.dir, "dev", "texts", "batch-001.json"), JSON.stringify({ cases: "do-not-print" }));
    const result = sim(c, "check", "mini", "--part", "dev", "--batches", "1-1");
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("dev/texts/batch-001.json");
    expect(result.stdout).not.toContain("do-not-print");
  });
});

describe("blind view and labels", () => {
  test("4 blind-export writes a file that parses and holds no slot field", async () => {
    const c = await planned();
    writeCleanBatch(c);
    const result = sim(c, "blind-export", "mini", "--part", "dev", "--batches", "1-1");
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
      sim(
        c,
        "blind-export",
        "mini",
        "--part",
        slot.part,
        "--batches",
        `${Number(slot.batch.slice(6))}-${Number(slot.batch.slice(6))}`
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
    expect(sim(c, "blind-export", "mini", "--part", "dev", "--batches", "1-1").code).toBe(0);
    writeFileSync(join(c.root, "labels.json"), labelFile(slots, true));
    const imported = sim(
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
    expect(sim(c, "reconcile", "mini", ...range).stdout).toBe(
      `disagree ${wrong.id} slot ${wrong.category} blind ${other} round 1\n`
    );
    expect(sim(c, "stale", "mini", ...range).stdout).toBe("");
    expect(sim(c, "check", "mini", ...range).stdout).toBe("ok\n");

    const first = texts[0] as CaseText;
    const rewrite = (patch: Partial<CaseText>) =>
      writeTexts(c, "dev", "batch-001", [{ ...first, ...patch }, ...texts.slice(1)]);
    rewrite({ body: `${first.body}\nTo jest nowe zdanie, ale nie ma w nim nic więcej.`, note: "rewritten: clearer" });
    expect(sim(c, "blind-export", "mini", ...range).code).toBe(0);
    expect(sim(c, "stale", "mini", ...range).stdout).toBe(`stale ${wrong.id}\n`);
    expect(sim(c, "reconcile", "mini", ...range).stdout).toBe("");
    const stale = sim(c, "check", "mini", ...range);
    expect(stale.code).toBe(1);
    expect(stale.stdout).toContain(`case ${wrong.id} label_stale`);

    writeFileSync(join(c.root, "again.json"), JSON.stringify([{ id: wrong.id, category: other }]));
    expect(
      sim(
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
      ).code
    ).toBe(0);
    expect(sim(c, "reconcile", "mini", ...range).stdout).toBe(
      `disagree ${wrong.id} slot ${wrong.category} blind ${other} round 2\n`
    );
    // The import replaced one label and kept the other 24.
    expect(readLabels(c.dir, "dev").size).toBe(25);

    rewrite({ body: `${first.body}\nTo jest nowe zdanie, ale nie ma w nim nic więcej.`, note: "borderline: both fit" });
    expect(sim(c, "reconcile", "mini", ...range).stdout).toBe("");
  });

  test("6 two blind-exports with no text change give the same file and no stale label", async () => {
    const c = await planned();
    const { slots } = writeCleanBatch(c);
    const range = ["--part", "dev", "--batches", "1-1"];
    const path = join(c.dir, "dev", "blind", "batch-001.json");
    expect(sim(c, "blind-export", "mini", ...range).code).toBe(0);
    const first = readFileSync(path, "utf8");
    writeFileSync(join(c.root, "labels.json"), JSON.stringify(slots.map((s) => ({ id: s.id, category: s.category }))));
    expect(
      sim(
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
      ).code
    ).toBe(0);
    expect(sim(c, "blind-export", "mini", ...range).code).toBe(0);
    expect(readFileSync(path, "utf8")).toBe(first);
    expect(sim(c, "stale", "mini", ...range).stdout).toBe("");
    expect(sim(c, "reconcile", "mini", ...range).stdout).toBe("");
    const status = sim(c, "status", "mini").stdout;
    expect(status).toMatch(/^total slots \d+ written 25 dropped 0 labelled 25 agree 25 disagree 0 borderline 0$/m);
  });

  test("label-import refuses an id with no blind entry and writes nothing", async () => {
    const c = await planned();
    writeCleanBatch(c);
    writeFileSync(join(c.root, "labels.json"), JSON.stringify([{ id: "b-zzz-9999", category: "info" }]));
    const result = sim(
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

async function complete(): Promise<MiniCorpus> {
  corpus = await completeCorpus();
  return corpus;
}

const freezeArgs = ["--version", "1", "--date", "2026-11-14", "--min-dev", "5", "--min-holdout", "20"];

async function frozen(): Promise<MiniCorpus> {
  const c = await complete();
  const result = sim(c, "freeze", "mini", ...freezeArgs);
  expect(result.stdout).toContain("frozen v1");
  expect(result.code).toBe(0);
  return c;
}

describe("freeze", () => {
  test("6 status says not frozen before freeze and v1 pending after it", async () => {
    const c = await complete();
    expect(sim(c, "status", "mini").stdout.split("\n")[0]).toBe("manifest: not frozen");
    const result = sim(c, "freeze", "mini", ...freezeArgs);
    expect(result.code).toBe(0);
    const manifest = readManifest(c.dir);
    expect(manifest?.audit).toEqual({
      status: "pending",
      list: "audit/v1-list.md",
      verdicts: "audit/v1-verdicts.json",
      wrong: 0,
    });
    expect(manifest?.frozenAt).toBe("2026-11-14");
    expect(sim(c, "status", "mini").stdout.split("\n")[0]).toBe("manifest: v1 audit pending (0 wrong)");
  });

  test("freeze with the CLI floors prints codes and counts and writes no manifest; a second freeze is refused", async () => {
    const c = await complete();
    const result = sim(c, "freeze", "mini", "--version", "1", "--date", "2026-11-14");
    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(/^too_few \d+$/m);
    expect(readManifest(c.dir)).toBeUndefined();
    expect(sim(c, "freeze", "mini", ...freezeArgs).code).toBe(0);
    const again = sim(c, "freeze", "mini", ...freezeArgs);
    expect(again.code).toBe(1);
    expect(again.stdout).toContain("manifest.json exists");
  });

  test("freeze refuses a corpus with a check issue or a missing text, naming ids and codes only", async () => {
    const c = await complete();
    const slot = slotsOf(c, "dev", "batch-002")[0] as Slot;
    const file = join(c.dir, "dev", "texts", "batch-002.json");
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    parsed.cases = parsed.cases.filter((text: CaseText) => text.id !== slot.id);
    writeFileSync(file, JSON.stringify(parsed));
    const result = sim(c, "freeze", "mini", ...freezeArgs);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain(`case ${slot.id} text_missing`);
    expect(readManifest(c.dir)).toBeUndefined();
  });
});

function verdictPath(c: MiniCorpus, version = "1"): string {
  return join(c.dir, "audit", `v${version}-verdicts.json`);
}

function setVerdicts(c: MiniCorpus, version: string, set: (id: string) => string): string[] {
  const file = JSON.parse(readFileSync(verdictPath(c, version), "utf8"));
  for (const entry of file.verdicts) entry.verdict = set(entry.id);
  writeFileSync(verdictPath(c, version), JSON.stringify(file));
  return file.verdicts.map((entry: { id: string }) => entry.id);
}

describe("audit", () => {
  test("7 audit-list prints paths and counts, never case text; the files hold 30 cases, all pending", async () => {
    const c = await frozen();
    const result = sim(c, "audit-list", "mini", "--version", "1");
    expect(result.code).toBe(0);
    const subjects = ["dev", "holdout", "week"].flatMap((part) =>
      [...readTexts(c.dir, part as SimPart).values()].map((text) => text.subject)
    );
    expect(subjects.some((subject) => result.stdout.includes(subject))).toBe(false);
    expect(result.stdout).toContain("audit/v1-list.md");
    expect(result.stdout).toContain("audit/v1-verdicts.json");
    expect(result.stdout).toContain("random 30 contested 0");
    const verdicts = JSON.parse(readFileSync(verdictPath(c), "utf8"));
    expect(verdicts.verdicts).toHaveLength(30);
    expect(verdicts.verdicts.every((entry: { verdict: string }) => entry.verdict === "pending")).toBe(true);
    const list = readFileSync(join(c.dir, "audit", "v1-list.md"), "utf8");
    const first = verdicts.verdicts[0].id;
    expect(list).toContain(`## ${first}`);
    expect(list).toContain("slot category:");
    expect(list).toContain("Mail as the checker sees it:");
    expect(list).toContain("Temat ");
    // The list is the same on a second run.
    expect(sim(c, "audit-list", "mini", "--version", "1").code).toBe(0);
    expect(readFileSync(join(c.dir, "audit", "v1-list.md"), "utf8")).toBe(list);
  });

  test("audit-list adds the contested cases (borderline notes) after the random ones", async () => {
    const c = await complete();
    const slot = slotsOf(c, "dev", "batch-001").find((s) => s.category === "info") as Slot;
    // A borderline note marks the case as contested, even when the labels agree.
    const file = join(c.dir, "dev", "texts", "batch-001.json");
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    for (const text of parsed.cases) if (text.id === slot.id) text.note = "borderline: both fit";
    writeFileSync(file, JSON.stringify(parsed));
    expect(sim(c, "freeze", "mini", ...freezeArgs).code).toBe(0);
    const result = sim(c, "audit-list", "mini", "--version", "1");
    expect(result.code).toBe(0);
    const verdicts = JSON.parse(readFileSync(verdictPath(c), "utf8"));
    const ids = verdicts.verdicts.map((entry: { id: string }) => entry.id);
    expect(ids).toContain(slot.id);
    expect(readFileSync(join(c.dir, "audit", "v1-list.md"), "utf8")).toContain("writer note: borderline: both fit");
  });

  test("5 audit-apply with one wrong verdict gives v1.1, done, wrong 1 and one changed part hash", async () => {
    const c = await frozen();
    expect(sim(c, "audit-list", "mini", "--version", "1").code).toBe(0);
    const before = readManifest(c.dir) as NonNullable<ReturnType<typeof readManifest>>;
    const ids = setVerdicts(c, "1", () => "ok");
    const target = ids[0] as string;
    const part = (["dev", "holdout", "week"] as SimPart[]).find((p) =>
      readSlots(c.dir, p).some((s) => s.id === target)
    ) as SimPart;
    const slot = readSlots(c.dir, part).find((s) => s.id === target) as Slot;
    const other = valueCategories.find((category) => category !== slot.category && category !== "urgent");
    setVerdicts(c, "1", (id) => (id === target ? `wrong: ${other}` : "ok"));

    const result = sim(c, "audit-apply", "mini", "--version", "1", "--date", "2026-11-20");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("wrong 1 pending 0");
    const after = readManifest(c.dir) as NonNullable<ReturnType<typeof readManifest>>;
    expect(after.version).toBe("1.1");
    expect(after.frozenAt).toBe("2026-11-20");
    expect(after.audit.status).toBe("done");
    expect(after.audit.wrong).toBe(1);
    for (const p of ["dev", "holdout", "week"] as const) {
      expect(after.parts[p].sha256 === before.parts[p].sha256).toBe(p !== part);
    }
    expect(readSlots(c.dir, part).find((s) => s.id === target)?.category).toBe(other);
    expect(sim(c, "status", "mini").stdout.split("\n")[0]).toBe("manifest: v1.1 audit done (1 wrong)");

    // The same file again changes nothing: no second bump.
    expect(sim(c, "audit-apply", "mini", "--version", "1", "--date", "2026-11-21").code).toBe(0);
    expect((readManifest(c.dir) as NonNullable<ReturnType<typeof readManifest>>).version).toBe("1.1");
    // A done audit gives no new list.
    const refused = sim(c, "audit-list", "mini", "--version", "1");
    expect(refused.code).toBe(1);
    expect(refused.stdout).toContain("is done");

    // A later change goes to 1.2.
    const next = readSlots(c.dir, part).find(
      (s) => s.id !== target && s.category !== "spam" && s.category !== "urgent"
    ) as Slot;
    writeFileSync(
      verdictPath(c, "1.1"),
      JSON.stringify({ scenario: "mini", version: "1.1", verdicts: [{ id: next.id, verdict: "wrong: spam" }] })
    );
    expect(sim(c, "audit-apply", "mini", "--version", "1.1", "--date", "2026-11-22").code).toBe(0);
    expect((readManifest(c.dir) as NonNullable<ReturnType<typeof readManifest>>).version).toBe("1.2");
  });

  test("audit-apply with a pending verdict keeps the audit pending; an unknown id changes nothing", async () => {
    const c = await frozen();
    expect(sim(c, "audit-list", "mini", "--version", "1").code).toBe(0);
    const ids = setVerdicts(c, "1", () => "ok");
    setVerdicts(c, "1", (id) => (id === ids[0] ? "pending" : "ok"));
    const result = sim(c, "audit-apply", "mini", "--version", "1", "--date", "2026-11-20");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("pending 1");
    const manifest = readManifest(c.dir) as NonNullable<ReturnType<typeof readManifest>>;
    expect(manifest.audit.status).toBe("pending");
    expect(manifest.version).toBe("1");

    writeFileSync(
      verdictPath(c),
      JSON.stringify({ scenario: "mini", version: "1", verdicts: [{ id: "x-nope", verdict: "ok" }] })
    );
    const unknown = sim(c, "audit-apply", "mini", "--version", "1", "--date", "2026-11-20");
    expect(unknown.code).toBe(1);
    expect(unknown.stdout).toContain("verdict_unknown x-nope");
  });

  test("audit-list needs a frozen corpus and never overwrites owner verdicts", async () => {
    const unfrozen = await complete();
    expect(sim(unfrozen, "audit-list", "mini", "--version", "1").code).toBe(1);
    unfrozen.cleanup();
    const c = await complete();
    expect(sim(c, "freeze", "mini", ...freezeArgs).code).toBe(0);
    expect(sim(c, "audit-list", "mini", "--version", "1").code).toBe(0);
    setVerdicts(c, "1", () => "ok");
    const refused = sim(c, "audit-list", "mini", "--version", "1");
    expect(refused.code).toBe(1);
    expect(refused.stdout).toContain("not overwritten");
  });
});
