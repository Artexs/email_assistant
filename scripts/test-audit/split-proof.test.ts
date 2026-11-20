import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JunitCase } from "./junit";
import { splitProof } from "./split-proof";

interface Spec {
  c: string;
  n: string;
  a?: number;
  skipped?: boolean;
}

const cases = (specs: Spec[], file: string): JunitCase[] =>
  specs.map((spec, index) => ({
    file,
    line: (index + 1) * (file === "old.test.ts" ? 10 : 7),
    name: spec.n,
    classname: spec.c,
    time: 0,
    assertions: spec.a ?? 1,
    skipped: spec.skipped ?? false,
  }));

const base: Spec[] = [
  { c: "a > d", n: "x", a: 2 },
  { c: "a > d", n: "y", a: 1 },
  { c: "d", n: "s", skipped: true },
];
const old = (specs: Spec[] = base): JunitCase[] => cases(specs, "old.test.ts");
const part = (specs: Spec[] = base): JunitCase[] => cases(specs, "part.test.ts");

describe("splitProof", () => {
  test("the same cases in other files and lines pass", () => {
    expect(splitProof(old(), part())).toEqual({ pass: true, lines: ["split-proof PASS cases=3"] });
  });

  test("a case that the parts lack is missing", () => {
    const result = splitProof(old(), part([base[0] as Spec, base[2] as Spec]));
    expect(result).toEqual({
      pass: false,
      lines: ["missing a > d :: y", "split-proof FAIL missing=1 extra=0"],
    });
  });

  test("a case that two parts run is extra", () => {
    const result = splitProof(old(), part([...base, base[0] as Spec]));
    expect(result).toEqual({
      pass: false,
      lines: ["extra a > d :: x", "split-proof FAIL missing=0 extra=1"],
    });
  });

  test("a case that stops being skipped is missing and extra", () => {
    const result = splitProof(old(), part([base[0] as Spec, base[1] as Spec, { c: "d", n: "s" }]));
    expect(result).toEqual({
      pass: false,
      lines: ["missing d :: s [skipped]", "extra d :: s", "split-proof FAIL missing=1 extra=1"],
    });
  });

  test("a changed assertion count is listed and does not fail", () => {
    const result = splitProof(old(), part([{ c: "a > d", n: "x", a: 3 }, base[1] as Spec, base[2] as Spec]));
    expect(result).toEqual({
      pass: true,
      lines: ["assertions a > d :: x 2 3", "split-proof PASS cases=3"],
    });
  });

  test("a side with no cases fails", () => {
    expect(splitProof([], part())).toEqual({ pass: false, lines: ["split-proof FAIL no cases"] });
  });
});

describe("command line", () => {
  const script = join(import.meta.dir, "split-proof.ts");
  const xml = (specs: Spec[]): string => {
    const items = specs.map((spec) => {
      const head = `<testcase name="${spec.n}" classname="${spec.c.replaceAll(">", "&gt;")}" file="f.ts" line="1" time="0" assertions="${spec.a ?? 1}"`;
      return spec.skipped ? `${head}><skipped/></testcase>` : `${head}/>`;
    });
    return `<testsuites>${items.join("")}</testsuites>`;
  };

  async function run(files: Record<string, Spec[]>, argv: (dir: string) => string[]) {
    const dir = await mkdtemp(join(tmpdir(), "split-proof-"));
    try {
      for (const [name, specs] of Object.entries(files)) await writeFile(join(dir, name), xml(specs));
      const proc = Bun.spawn(["bun", script, ...argv(dir)], { stdout: "pipe", stderr: "pipe" });
      const stdout = await new Response(proc.stdout).text();
      return { code: await proc.exited, stdout };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  test("a missing case exits 1 with the lines on stdout", async () => {
    const lacking = [base[0] as Spec, base[2] as Spec];
    const result = await run({ "before.xml": base, "after.xml": lacking }, (dir) => [
      "--before",
      join(dir, "before.xml"),
      "--after",
      join(dir, "after.xml"),
    ]);
    expect(result).toEqual({ code: 1, stdout: "missing a > d :: y\nsplit-proof FAIL missing=1 extra=0\n" });
  });

  test("no --after exits 2", async () => {
    const result = await run({ "before.xml": base }, (dir) => ["--before", join(dir, "before.xml")]);
    expect(result).toEqual({ code: 2, stdout: "" });
  });

  test("the cases of several --after files form one multiset", async () => {
    const result = await run(
      { "before.xml": base, "one.xml": [base[0] as Spec, base[1] as Spec], "two.xml": [base[2] as Spec] },
      (dir) => ["--before", join(dir, "before.xml"), "--after", join(dir, "one.xml"), "--after", join(dir, "two.xml")]
    );
    expect(result).toEqual({ code: 0, stdout: "split-proof PASS cases=3\n" });
  });
});
