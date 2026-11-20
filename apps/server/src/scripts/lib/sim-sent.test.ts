import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  miniScenario,
  miniSentPlanSpec,
  sentBlindBatchFileSchema,
  sentExpectedOf,
  sentFixtureText,
  sentManifestSchema,
  sentParts,
  type SentPart,
  type SentSlot,
} from "@ea/core";
import { afterAll, afterEach, describe, expect, test } from "bun:test";

import { listBatches, SimFileError } from "../../platform/sim-files";
import { readSentManifest, readSentSlots, readSentTexts, sentEvalCasesOf } from "../../platform/sim-sent-files";

import { runSimInProcess } from "./sim-fixtures.test-helper";
import {
  completeSentCorpus,
  createSentCorpus,
  miniSentFloors,
  writeSentTexts,
  type SentCorpus,
  removeAllSentCorpora,
} from "./sim-sent-fixtures.test-helper";

afterAll(removeAllSentCorpora);
let corpus: SentCorpus | undefined;
afterEach(() => {
  corpus?.cleanup();
  corpus = undefined;
});

const sim = (c: SentCorpus, ...args: string[]) => runSimInProcess([...args, "--root", c.root]);

async function planned(): Promise<SentCorpus> {
  corpus = await createSentCorpus({ plan: true });
  return corpus;
}

async function complete(): Promise<SentCorpus> {
  corpus = await completeSentCorpus();
  return corpus;
}

function slotFiles(c: SentCorpus): string[] {
  return sentParts.flatMap((part) =>
    readdirSync(join(c.dir, part, "slots")).map((file) => readFileSync(join(c.dir, part, "slots", file), "utf8"))
  );
}

const slotOf = (c: SentCorpus, part: SentPart, pick: (slot: SentSlot) => boolean): SentSlot =>
  readSentSlots(c.dir, part).find(pick) as SentSlot;

describe("sent plan", () => {
  test("T1 plan writes both parts; a second plan gives the same files; texts make it refuse unless --force", async () => {
    corpus = await createSentCorpus();
    const first = await sim(corpus, "plan", "mini", "--bank", "sent");
    expect(first.code).toBe(0);
    expect(first.stdout).toContain("part sent-dev slots 20 batches 1");
    expect(first.stdout).toContain("part sent-holdout slots 60 batches 3");
    const before = slotFiles(corpus);
    expect(before).toHaveLength(4);
    expect(existsSync(join(corpus.dir, "dev"))).toBe(false);

    expect((await sim(corpus, "plan", "mini", "--bank", "sent")).code).toBe(0);
    expect(slotFiles(corpus)).toEqual(before);

    const slot = slotOf(corpus, "sent-dev", () => true);
    writeSentTexts(corpus, "sent-dev", "batch-001", [sentFixtureText(slot)]);
    const refused = await sim(corpus, "plan", "mini", "--bank", "sent");
    expect(refused.code).toBe(1);
    expect(refused.stdout).toContain("texts exist: use --force");
    expect(slotFiles(corpus)).toEqual(before);
    expect((await sim(corpus, "plan", "mini", "--bank", "sent", "--force")).code).toBe(0);
    expect(slotFiles(corpus)).toEqual(before);
  });

  test("a new plan removes the batch files of the old plan", async () => {
    const c = await planned();
    expect(readdirSync(join(c.dir, "sent-holdout", "slots"))).toHaveLength(3);
    writeFileSync(
      join(c.dir, "sent-plan-spec.json"),
      JSON.stringify({ ...miniSentPlanSpec, sizes: { dev: 20, holdout: 40 } })
    );
    expect((await sim(c, "plan", "mini", "--bank", "sent")).code).toBe(0);
    expect(readdirSync(join(c.dir, "sent-holdout", "slots")).sort()).toEqual(["batch-001.json", "batch-002.json"]);
  });

  test("a plan of the sent bank leaves the incoming parts alone", async () => {
    const c = await planned();
    expect(readdirSync(c.dir).sort()).toEqual(["scenario.json", "sent-dev", "sent-holdout", "sent-plan-spec.json"]);
  });

  test("a missing sent-plan-spec.json is a file error with the path", async () => {
    corpus = await createSentCorpus();
    rmSync(join(corpus.dir, "sent-plan-spec.json"));
    const result = await sim(corpus, "plan", "mini", "--bank", "sent");
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("sent-plan-spec.json: missing");
  });
});

describe("sent brief and check", () => {
  test("the brief names the executive voice and signature, the recipients and the slots", async () => {
    const c = await planned();
    const result = await sim(c, "brief", "mini", "--part", "sent-dev", "--batch", "1");
    expect(result.code).toBe(0);
    const out = JSON.parse(result.stdout) as {
      executive: { signature: string; voice: string; timeZone: string };
      personas: { key: string; voice: string; signature: string }[];
      slots: SentSlot[];
    };
    expect(out.executive.signature).toBe(miniScenario.executive.signature);
    expect(out.executive.voice).toBe(miniScenario.executive.voice);
    expect(out.executive.timeZone).toBe("Europe/Warsaw");
    expect(out.slots).toHaveLength(20);
    const recipients = new Set(out.slots.flatMap((slot) => [...slot.to, ...slot.cc]));
    for (const key of recipients) expect(out.personas.map((p) => p.key)).toContain(key);
    expect(out.personas.map((p) => p.key)).not.toContain(miniScenario.executive.key);
    expect((await sim(c, "brief", "mini", "--part", "sent-dev", "--batch", "9")).code).toBe(1);
  });

  test("check prints ok for clean texts and one `case <id> <code>` line per issue, never text", async () => {
    const c = await planned();
    const slots = readSentSlots(c.dir, "sent-dev");
    writeSentTexts(
      c,
      "sent-dev",
      "batch-001",
      slots.map((slot) => sentFixtureText(slot))
    );
    const clean = await sim(c, "check", "mini", "--part", "sent-dev", "--batches", "1-1");
    expect(clean.code).toBe(0);
    expect(clean.stdout.trim()).toBe("ok");

    const withSignature = slots.find((slot) => slot.style.signature) as SentSlot;
    const texts = slots.map((slot) => {
      const text = sentFixtureText(slot);
      return slot.id === withSignature.id
        ? { ...text, body: text.body.replace(miniScenario.executive.signature, "") }
        : text;
    });
    writeSentTexts(c, "sent-dev", "batch-001", texts.slice(0, -1));
    const bad = await sim(c, "check", "mini", "--part", "sent-dev", "--batches", "1-1");
    expect(bad.code).toBe(1);
    expect(bad.stdout).toContain(`case ${withSignature.id} signature`);
    expect(bad.stdout).toContain(`case ${(slots.at(-1) as SentSlot).id} missing_text`);
    expect(bad.stdout).toMatch(/^issues 2$/m);
    expect(bad.stdout).not.toContain("Dzień");
  });

  test("a text with no slot and a nothing-written range", async () => {
    const c = await planned();
    expect((await sim(c, "check", "mini", "--part", "sent-dev")).stdout).toContain("nothing written in range");
    const slot = slotOf(c, "sent-dev", () => true);
    writeSentTexts(c, "sent-dev", "batch-001", [{ ...sentFixtureText(slot), id: "s-9999" }]);
    expect((await sim(c, "check", "mini", "--part", "sent-dev")).stdout).toContain("case s-9999 slot_unknown");
  });

  test("T4 the incoming check on the real corpus still prints ok", async () => {
    const result = await runSimInProcess(["check", "lab-01", "--part", "dev"]);
    expect(result.stdout.trim()).toBe("ok");
    expect(result.code).toBe(0);
  });
});

describe("sent blind export, labels, reconcile", () => {
  test("T5 the blind file holds blind cases only: no slot field and no labels", async () => {
    const c = await complete();
    const path = join(c.dir, "sent-dev", "blind", "batch-001.json");
    const raw = readFileSync(path, "utf8");
    expect(JSON.parse(raw)).not.toHaveProperty("labels");
    expect(raw).not.toContain('"labels"');
    expect(raw).not.toContain('"hardCases"');
    expect(raw).not.toContain('"brief"');
    const file = sentBlindBatchFileSchema.parse(JSON.parse(raw));
    expect(file.cases).toHaveLength(20);
    expect(file.cases[0]).toHaveProperty("threadSubjects");
    expect((await sim(c, "blind-export", "mini", "--part", "sent-dev", "--batches", "7-8")).stdout).toContain(
      "nothing written in range"
    );
  });

  test("label-import keeps the checker, adds the hash and refuses an unknown id or a bad label", async () => {
    const c = await complete();
    const slot = slotOf(c, "sent-dev", () => true);
    const expected = { id: slot.id, ...sentExpectedOf(slot, "Europe/Warsaw") };
    const file = join(c.root, "one.json");
    writeFileSync(file, JSON.stringify([expected]));
    const imported = await sim(
      c,
      "label-import",
      "mini",
      "--part",
      "sent-dev",
      "--batch",
      "1",
      "--checker",
      "m2",
      "--file",
      file
    );
    expect(imported.stdout).toContain("imported 1 total 20");
    const stored = JSON.parse(readFileSync(join(c.dir, "sent-dev", "labels", "batch-001.json"), "utf8")) as {
      checker: string;
      labels: { id: string; blindHash: string }[];
    };
    expect(stored.checker).toBe("m2");
    expect(stored.labels.find((l) => l.id === slot.id)?.blindHash).toMatch(/^[0-9a-f]{64}$/);

    writeFileSync(file, JSON.stringify([{ ...expected, id: "s-9999" }]));
    const unknown = await sim(
      c,
      "label-import",
      "mini",
      "--part",
      "sent-dev",
      "--batch",
      "1",
      "--checker",
      "m2",
      "--file",
      file
    );
    expect(unknown.code).toBe(1);
    expect(unknown.stdout).toContain("label_unknown s-9999");

    // A promise with no date is not a label.
    writeFileSync(file, JSON.stringify([{ ...expected, promise: true, promiseDue: null }]));
    const invalid = await sim(
      c,
      "label-import",
      "mini",
      "--part",
      "sent-dev",
      "--batch",
      "1",
      "--checker",
      "m2",
      "--file",
      file
    );
    expect(invalid.code).toBe(1);
    expect(invalid.stdout).toContain(`label_invalid ${slot.id}`);
    writeFileSync(file, "not json");
    expect(
      (await sim(c, "label-import", "mini", "--part", "sent-dev", "--batch", "1", "--checker", "m2", "--file", file))
        .code
    ).toBe(1);
  });

  test("T6 a label for an old hash is stale after a rewrite; stale lists it and check reports it", async () => {
    const c = await complete();
    expect((await sim(c, "stale", "mini", "--part", "sent-dev", "--batches", "1-1")).stdout).toBe("");
    const slot = slotOf(c, "sent-dev", () => true);
    const texts = [...readSentTexts(c.dir, "sent-dev").values()].map((text) =>
      text.id === slot.id ? { ...text, body: `${text.body}\nPS` } : text
    );
    writeSentTexts(c, "sent-dev", "batch-001", texts);
    const stale = await sim(c, "stale", "mini", "--part", "sent-dev", "--batches", "1-1");
    expect(stale.stdout.trim()).toBe(`stale ${slot.id}`);
    expect((await sim(c, "check", "mini", "--part", "sent-dev", "--batches", "1-1")).stdout).toContain(
      `case ${slot.id} label_stale`
    );
    // Reconcile ignores a stale label, also one that disagrees with the slot.
    const stored = join(c.dir, "sent-dev", "labels", "batch-001.json");
    const file = JSON.parse(readFileSync(stored, "utf8")) as { labels: { id: string; expectsReply: boolean }[] };
    const own = file.labels.find((label) => label.id === slot.id) as { expectsReply: boolean };
    own.expectsReply = !own.expectsReply;
    writeFileSync(stored, JSON.stringify(file));
    expect((await sim(c, "reconcile", "mini", "--part", "sent-dev", "--batches", "1-1")).stdout).toBe("");
    await sim(c, "blind-export", "mini", "--part", "sent-dev", "--batches", "1-1");
    expect((await sim(c, "stale", "mini", "--part", "sent-dev", "--batches", "1-1")).stdout.trim()).toBe(
      `stale ${slot.id}`
    );
  });

  test("check reports a label of a case that has no text as label_unknown", async () => {
    const c = await complete();
    const slot = slotOf(c, "sent-dev", () => true);
    const texts = [...readSentTexts(c.dir, "sent-dev").values()].filter((text) => text.id !== slot.id);
    writeSentTexts(c, "sent-dev", "batch-001", texts);
    const result = await sim(c, "check", "mini", "--part", "sent-dev", "--batches", "1-1");
    expect(result.stdout).toContain(`case ${slot.id} missing_text`);
    expect(result.stdout).toContain(`case ${slot.id} label_unknown`);
  });

  test("reconcile lists the id and the fields in which a fresh label differs from the slot", async () => {
    const c = await complete();
    const slot = slotOf(c, "sent-holdout", (s) => s.labels.due !== null);
    const file = join(c.root, "wrong.json");
    const expected = sentExpectedOf(slot, "Europe/Warsaw");
    writeFileSync(file, JSON.stringify([{ id: slot.id, ...expected, due: "2026-12-31" }]));
    const n = String(Number(slot.batch.slice("batch-".length)));
    await sim(c, "label-import", "mini", "--part", "sent-holdout", "--batch", n, "--checker", "m", "--file", file);
    const result = await sim(c, "reconcile", "mini", "--part", "sent-holdout", "--batches", "1-3");
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(`disagree ${slot.id} fields due`);
  });

  test("status counts written, labelled and agreeing cases", async () => {
    const c = await planned();
    expect((await sim(c, "status", "mini", "--part", "sent-dev")).stdout).toContain(
      "part sent-dev slots 20 written 0 labelled 0 agree 0 disagree 0"
    );
    const done = await complete();
    const status = await sim(done, "status", "mini", "--part", "sent-dev");
    expect(status.stdout).toContain("not frozen");
    expect(status.stdout).toContain("part sent-dev slots 20 written 20 labelled 20 agree 20 disagree 0");
    expect(status.stdout).toContain("part sent-dev tag thanks_only slots 1 written 1");
    corpus = undefined;
    c.cleanup();
  });
});

describe("sent freeze", () => {
  const freeze = (c: SentCorpus, ...extra: string[]) =>
    sim(c, "freeze", "mini", "--bank", "sent", "--date", "2026-11-15", ...miniSentFloors, ...extra);

  test("T8 a freeze of agreeing labels writes sent-v1 with the part hashes; manifest.json is not touched", async () => {
    const c = await complete();
    const result = await freeze(c);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("frozen sent-v1");
    const manifest = sentManifestSchema.parse(JSON.parse(readFileSync(join(c.dir, "sent-manifest.json"), "utf8")));
    expect(manifest.version).toBe("sent-v1");
    expect(manifest.frozenAt).toBe("2026-11-15");
    expect(manifest.parts["sent-dev"]?.cases).toBe(20);
    expect(manifest.parts["sent-holdout"]?.cases).toBe(60);
    expect(manifest.dropped).toEqual({ "sent-dev": [], "sent-holdout": [] });
    expect(existsSync(join(c.dir, "manifest.json"))).toBe(false);
    expect((await sim(c, "status", "mini", "--part", "sent-holdout")).stdout).toContain("frozen sent-v1");
  });

  test("T8 a second freeze changes nothing; a changed text makes sent-v2", async () => {
    const c = await complete();
    await freeze(c);
    const first = readFileSync(join(c.dir, "sent-manifest.json"), "utf8");
    const again = await freeze(c);
    expect(again.code).toBe(0);
    expect(again.stdout.trim()).toBe("unchanged sent-v1");
    expect(readFileSync(join(c.dir, "sent-manifest.json"), "utf8")).toBe(first);

    // A rewrite of one text makes its label stale: the freeze (it runs the check first) refuses.
    const slot = slotOf(c, "sent-holdout", () => true);
    const slotsOf = readSentSlots(c.dir, "sent-holdout");
    const texts = [...readSentTexts(c.dir, "sent-holdout").values()].map((text) =>
      text.id === slot.id ? { ...text, body: `${text.body}\nPS` } : text
    );
    for (const batch of listBatches(c.dir, "sent-holdout", "texts")) {
      const ids = new Set(slotsOf.filter((s) => s.batch === batch).map((s) => s.id));
      writeSentTexts(
        c,
        "sent-holdout",
        batch,
        texts.filter((text) => ids.has(text.id))
      );
    }
    const blocked = await freeze(c);
    expect(blocked.code).toBe(1);
    expect(blocked.stdout).toContain(`case ${slot.id} label_stale`);
    await sim(c, "blind-export", "mini", "--part", "sent-holdout", "--batches", "1-3");
    const file = join(c.root, "fix.json");
    writeFileSync(file, JSON.stringify([{ id: slot.id, ...sentExpectedOf(slot, "Europe/Warsaw") }]));
    const n = String(Number(slot.batch.slice("batch-".length)));
    await sim(c, "label-import", "mini", "--part", "sent-holdout", "--batch", n, "--checker", "m", "--file", file);
    const next = await freeze(c);
    expect(next.stdout).toContain("frozen sent-v2");
    expect(readSentManifest(c.dir)?.version).toBe("sent-v2");
  });

  test("T7 one due disagreement blocks the freeze with label_disagrees; no manifest is written", async () => {
    const c = await complete();
    const slot = slotOf(c, "sent-holdout", (s) => s.labels.due !== null);
    const file = join(c.root, "wrong.json");
    writeFileSync(file, JSON.stringify([{ id: slot.id, ...sentExpectedOf(slot, "Europe/Warsaw"), due: "2026-12-31" }]));
    const n = String(Number(slot.batch.slice("batch-".length)));
    await sim(c, "label-import", "mini", "--part", "sent-holdout", "--batch", n, "--checker", "m", "--file", file);
    const result = await freeze(c);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("label_disagrees 1");
    expect(result.stdout).toContain(`label_disagrees sent-holdout ${slot.id} due`);
    expect(existsSync(join(c.dir, "sent-manifest.json"))).toBe(false);
  });

  test("a case with no label blocks the freeze with unlabelled", async () => {
    const c = await complete();
    rmSync(join(c.dir, "sent-dev", "labels", "batch-001.json"));
    const result = await freeze(c);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("unlabelled 20");
    expect(result.stdout).toMatch(/too_few 1/);
    expect(existsSync(join(c.dir, "sent-manifest.json"))).toBe(false);
  });

  test("a case with no text stops the freeze at the check (missing_text)", async () => {
    const c = await complete();
    rmSync(join(c.dir, "sent-dev", "texts", "batch-001.json"));
    const result = await freeze(c);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("case s-");
  });

  test("the floors: a freeze below its floor is refused", async () => {
    const c = await complete();
    const result = await sim(c, "freeze", "mini", "--bank", "sent", "--min-dev", "21", "--min-holdout", "60");
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("too_few sent-dev 20|21");
  });

  test("a recorded slot removal is a dropped case in the manifest", async () => {
    const c = await complete();
    const gone = slotOf(c, "sent-holdout", (s) => s.batch === "batch-003");
    const rest = readSentSlots(c.dir, "sent-holdout").filter((s) => s.batch === "batch-003" && s.id !== gone.id);
    writeFileSync(
      join(c.dir, "sent-holdout", "slots", "batch-003.json"),
      JSON.stringify({ scenario: "mini", part: "sent-holdout", batch: "batch-003", slots: rest })
    );
    for (const dir of ["texts", "blind", "labels"]) {
      const path = join(c.dir, "sent-holdout", dir, "batch-003.json");
      const json = JSON.parse(readFileSync(path, "utf8")) as { cases?: { id: string }[]; labels?: { id: string }[] };
      if (json.cases !== undefined) json.cases = json.cases.filter((x) => x.id !== gone.id);
      if (json.labels !== undefined) json.labels = json.labels.filter((x) => x.id !== gone.id);
      writeFileSync(path, JSON.stringify(json));
    }
    const result = await sim(c, "freeze", "mini", "--bank", "sent", "--min-dev", "20", "--min-holdout", "59");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(`dropped sent-holdout ${gone.id}`);
    expect(readSentManifest(c.dir)?.dropped["sent-holdout"]).toEqual([gone.id]);
  });
});

describe("sent eval cases", () => {
  test("T9 a dev part gives cases with the blind view and the slot labels", async () => {
    const c = await complete();
    const cases = sentEvalCasesOf(c.root, "mini", "sent-dev");
    expect(cases).toHaveLength(20);
    const slot = readSentSlots(c.dir, "sent-dev")[0] as SentSlot;
    const first = cases[0];
    expect(first?.id).toBe(slot.id);
    expect(first?.labels).toEqual(slot.labels);
    expect(first?.expected).toEqual(sentExpectedOf(slot, "Europe/Warsaw"));
    expect(first?.blind.body).toBe(readSentTexts(c.dir, "sent-dev").get(slot.id)?.body as string);
    expect(JSON.stringify(first?.blind)).not.toContain("expectsReply");
  });

  test("an injection case carries the planted strings of its text; any other case has none", async () => {
    const c = await complete();
    const cases = sentEvalCasesOf(c.root, "mini", "sent-dev");
    const injection = cases.filter((item) => item.hardCases.includes("injection_quote"));
    expect(injection.length).toBeGreaterThan(0);
    for (const item of injection) {
      expect(item.planted).toEqual(readSentTexts(c.dir, "sent-dev").get(item.id)?.planted as string[]);
      expect(item.planted.length).toBeGreaterThan(0);
    }
    expect(
      cases.filter((item) => !item.hardCases.includes("injection_quote")).every((item) => item.planted.length === 0)
    ).toBe(true);
  });

  test("T10 the holdout loads only with { holdout: true }", async () => {
    const c = await complete();
    expect(() => sentEvalCasesOf(c.root, "mini", "sent-holdout")).toThrow(SimFileError);
    expect(() => sentEvalCasesOf(c.root, "mini", "sent-holdout", {})).toThrow("holdout: true");
    expect(sentEvalCasesOf(c.root, "mini", "sent-holdout", { holdout: true })).toHaveLength(60);
  });
});
