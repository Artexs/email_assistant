import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { evalCaseSchema, miniScenario, type EvalCase, UsageError } from "@ea/core";
import { afterAll, afterEach, describe, expect, test } from "bun:test";

import { renderSuspiciousReport, suspiciousInputOfCase, suspiciousRows } from "../../modules/triage";
import { readSlots, writeJson } from "../../platform/sim-files";
import { parseEvalArgs } from "../eval-args";

import { runSuspicious } from "./eval-suspicious";
import { createMiniCorpus, fixtureText, type MiniCorpus, removeAllCorpora } from "./sim-fixtures.test-helper";

function makeCase(id: string, patch: Partial<EvalCase> & { hardCases?: string[]; headers?: Record<string, string> }) {
  const { hardCases = [], headers = {}, ...rest } = patch;
  return evalCaseSchema.parse({
    id,
    kind: "synthetic",
    lang: "en",
    from: "Persona client-a <client-a@client-a.test>",
    to: ["szef@mini.test"],
    subject: "Subject",
    body: "Body",
    expected: { category: "info" },
    sim: { corpus: "mini", version: "1", part: "dev", slotId: id, hardCases, headers, attachments: [] },
    ...rest,
  });
}

// One look-alike phishing mail, one whitelisted mail, one newsletter whose link text host equals its host.
const phishing = makeCase("zz-phish-01", {
  from: "Billing <billing@vendor-k.test>",
  expected: { category: "spam" },
  hardCases: ["phishing_delegation"],
});
const whitelisted = makeCase("zz-white-01", {
  from: "Persona prezes <prezes@mini.test>",
  senderRules: [{ pattern: "prezes@mini.test", kind: "whitelist" }],
});
const newsletter = makeCase("zz-news-01", {
  from: "News <digest@news-d.test>",
  expected: { category: "notification" },
  headers: { "List-Id": "<news.news-d.test>" },
});
const newsletterHtml = '<p><a href="https://shop.news-d.test/a">https://shop.news-d.test</a></p>';

const corpus = { scenario: "mini", version: "1", part: "dev", manifestSha: null, audit: "not frozen" };

describe("suspicious sim measurement", () => {
  test("1. look-alike phishing 1 of 1, whitelisted flagged 0, newsletter link with the same host flagged 0", () => {
    const rows = suspiciousRows(
      [phishing, whitelisted, newsletter],
      miniScenario,
      new Map([["zz-news-01", newsletterHtml]])
    );
    expect(rows.map((row) => row.reasons)).toEqual([["lookalike_domain"], [], []]);
    expect(rows.map((row) => row.phishingTags.length > 0)).toEqual([true, false, false]);
    expect(rows.map((row) => row.whitelisted)).toEqual([false, true, false]);

    const report = renderSuspiciousReport({ rows, corpus, date: "2026-11-15", listIds: true });
    expect(report).toContain("| phishing recall | >= 90% | 1 of 1 (100.0%) | met |");
    expect(report).toContain("| whitelisted cases flagged | 0 | 0 of 1 | met |");
    expect(report).toContain("| non-phishing flag rate | <= 2% | 0 of 2 (0.0%) | met |");
    expect(report).toContain("| lookalike_domain | 1 | 1 | 0 |");
  });

  test("the HTML part feeds the link rule: a link text that shows another host is flagged for an unknown sender", () => {
    const mismatch = '<a href="https://evil.test/x">www.bank.test</a>';
    expect(suspiciousInputOfCase(phishing, miniScenario, mismatch).links).toEqual([
      { host: "evil.test", textHost: "www.bank.test" },
    ]);
    const plain = makeCase("zz-plain-01", { from: "Shop <shop@shop-q.test>" });
    const rowOf = (item: EvalCase) => suspiciousRows([item], miniScenario, new Map([[item.id, mismatch]]))[0];
    expect(rowOf(plain)?.reasons).toEqual(["link_mismatch"]);
    // A list mail is exempt from the link rule.
    expect(rowOf(newsletter)?.reasons).toEqual([]);
    // Without the HTML part there is no link to read.
    expect(suspiciousRows([plain], miniScenario, new Map())[0]?.reasons).toEqual([]);
  });

  test("sim mapping: known senders, protected names, header fields and attachment types", () => {
    const withFacts = makeCase("zz-facts-01", {
      from: "Persona anna <anna@mini.test>",
      sim: {
        corpus: "mini",
        version: "1",
        part: "dev",
        slotId: "zz-facts-01",
        hardCases: [],
        headers: { "reply-to": "x@other.test", "Authentication-Results": "mx.mini.test; dmarc=fail" },
        attachments: [
          { name: "run.exe", mime: "application/pdf", sizeBytes: 1 },
          { name: "note.pdf", mime: "application/x-msdownload", sizeBytes: 1 },
          { name: "blob.xyz", mime: "application/pdf", sizeBytes: 1 },
        ],
      },
    });
    const input = suspiciousInputOfCase(withFacts, miniScenario);
    expect(input.senderKnown).toBe(true);
    expect(input.replyTo).toEqual(["x@other.test"]);
    expect(input.authResults).toBe("mx.mini.test; dmarc=fail");
    expect(input.trustedAuthservIds).toEqual([]);
    expect(input.attachments).toEqual([
      { name: "run.exe", type: "application/octet-stream" },
      { name: "note.pdf", type: "application/pdf" },
      { name: "blob.xyz", type: "application/octet-stream" },
    ]);
    // Delegates and VIP personas are protected names; the news persona is not a known sender.
    expect(input.protectedNames.sort()).toEqual(["Persona anna", "Persona marek", "Persona prezes"]);
    expect(suspiciousInputOfCase(newsletter, miniScenario).senderKnown).toBe(false);
    expect(suspiciousInputOfCase(newsletter, miniScenario).isList).toBe(true);
    // The known domains hold the company, the known persona hosts and nothing of the news persona.
    expect(input.knownDomains).toEqual(["client-a.test", "mini.test", "partner-b.test", "vendor-c.test"].sort());
    // Only a whitelist or VIP rule of the case makes an address known.
    const ruled = makeCase("zz-rule-01", {
      from: "Ruled <ruled@ruled.test>",
      senderRules: [{ pattern: "ruled@ruled.test", kind: "whitelist" }],
    });
    expect(suspiciousInputOfCase(ruled, miniScenario).senderKnown).toBe(true);
    expect(suspiciousInputOfCase(ruled, miniScenario).knownDomains).toContain("ruled.test");
  });

  test("a free-mail domain rule never makes a sender known by its domain", () => {
    const ruled = makeCase("zz-free-01", {
      from: "Other <other@gmail.com>",
      senderRules: [{ pattern: "@gmail.com", kind: "whitelist" }],
    });
    const input = suspiciousInputOfCase(ruled, miniScenario);
    expect(input.senderKnown).toBe(false);
    expect(input.knownDomains).not.toContain("gmail.com");
  });

  test("2. --suspicious with --judge, a model, a provider or no --sim is a usage error with exit code 2", () => {
    const base = ["--sim", "lab-01", "--part", "dev", "--suspicious"];
    expect(parseEvalArgs(base)).toMatchObject({ suspicious: true, sim: "lab-01", part: "dev" });
    expect(parseEvalArgs([...base, "--out", "x.md"])).toMatchObject({ out: "x.md" });
    for (const extra of [["--judge"], ["--model", "gpt-6-luna"], ["--provider", "openai"], ["--budget-usd", "1"]]) {
      expect(() => parseEvalArgs([...base, ...extra])).toThrow(UsageError);
    }
    expect(() => parseEvalArgs(["--suspicious"])).toThrow(UsageError);
    expect(() => parseEvalArgs(["--part", "dev", "--suspicious"])).toThrow(UsageError);

    const script = resolve(import.meta.dir, "../eval.ts");
    const result = Bun.spawnSync(["bun", script, ...base, "--judge"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain("usage: bun run eval");
  });
});

describe("eval --suspicious command", () => {
  test("the real script runs the rules on lab-01 dev with no key and prints the report", () => {
    const script = resolve(import.meta.dir, "../eval.ts");
    const result = Bun.spawnSync(["bun", script, "--sim", "lab-01", "--part", "dev", "--suspicious"], {
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
    });
    expect(result.exitCode).toBe(0);
    const out = result.stdout.toString();
    expect(out).toContain("# Suspicious-mail rules: sim lab-01 dev");
    expect(out).toContain("| phishing recall | >= 90% |");
  });
});

describe("holdout report", () => {
  let mini: MiniCorpus | undefined;
  afterAll(removeAllCorpora);
  afterEach(() => {
    mini?.cleanup();
    mini = undefined;
  });

  test("3. holds no case id; the dev report lists them", () => {
    const rows = suspiciousRows([phishing, whitelisted, newsletter], miniScenario, new Map());
    const holdout = renderSuspiciousReport({
      rows,
      corpus: { ...corpus, part: "holdout", manifestSha: "a".repeat(64), audit: "pending" },
      date: "2026-11-15",
      listIds: false,
    });
    for (const id of ["zz-phish-01", "zz-white-01", "zz-news-01"]) expect(holdout).not.toContain(id);
    expect(holdout).toContain("manifest aaaaaaaaaaaa");
    expect(holdout).toContain("| lookalike_domain | 1 | 1 | 0 |");
    const flaggedOther = makeCase("zz-other-01", {
      from: "Billing <billing@vendor-k.test>",
      expected: { category: "spam" },
    });
    const devRows = suspiciousRows([phishing, flaggedOther], miniScenario, new Map());
    const dev = renderSuspiciousReport({ rows: devRows, corpus, date: "2026-11-15", listIds: true });
    expect(dev).toContain("- zz-other-01 (spam): lookalike_domain");
    expect(dev).toContain("| non-phishing flag rate | <= 2% | 1 of 1 (100.0%) | missed |");
  });

  test("the run on a holdout corpus writes no slot id to the output or the file", async () => {
    mini = await createMiniCorpus({ plan: true });
    for (const part of ["dev", "holdout"] as const) {
      const slots = readSlots(mini.dir, part);
      for (const batch of new Set(slots.map((slot) => slot.batch))) {
        writeJson(join(mini.dir, part, "texts", `${batch}.json`), {
          scenario: "mini",
          part,
          batch,
          writer: "fixture",
          cases: slots.filter((slot) => slot.batch === batch).map((slot) => fixtureText(slot)),
        });
      }
    }
    writeJson(join(mini.dir, "manifest.json"), { version: "1", audit: { status: "pending" } });
    const run = async (part: "dev" | "holdout") => {
      let text = "";
      const options = parseEvalArgs([
        "--sim",
        "mini",
        "--part",
        part,
        "--suspicious",
        "--out",
        join(mini?.root ?? "", `${part}.md`),
      ]);
      const code = await runSuspicious(options as NonNullable<typeof options>, {
        root: mini?.root,
        now: () => new Date("2026-11-15T10:00:00Z"),
        write: (value) => {
          text = value;
        },
      });
      return { code, text };
    };
    const holdout = await run("holdout");
    expect(holdout.code).toBe(0);
    const holdoutIds = readSlots((mini as MiniCorpus).dir, "holdout").map((slot) => slot.id);
    expect(holdoutIds.length).toBeGreaterThan(0);
    for (const id of holdoutIds) expect(holdout.text).not.toContain(id);
    // The same text goes to the file.
    expect(readFileSync(join(mini.root, "holdout.md"), "utf8")).toBe(holdout.text);

    const dev = await run("dev");
    expect(dev.code).toBe(0);
    expect(dev.text).toContain("ids listed: yes (dev)");
  });
});
