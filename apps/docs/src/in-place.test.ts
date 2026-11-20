import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Loader } from "astro/loaders";

import {
  docsGitRef,
  IN_PLACE_PAGES,
  inPlaceLoader,
  inPlaceSourcePaths,
  readInPlaceSource,
  repoRoot,
  rewriteLinks,
  splitSource,
} from "./in-place";

const GITHUB = "https://github.com/Artexs/email_assistant/blob";

describe("rewriteLinks", () => {
  test.each([
    [
      "T1 a link to another repository file becomes a GitHub link at the ref",
      "[a](../docs/architecture.md)",
      "v0.1.0",
      `[a](${GITHUB}/v0.1.0/docs/architecture.md)`,
    ],
    [
      "T2 a link in the same folder keeps its anchor",
      "[b](./backup.sh#L3)",
      "master",
      `[b](${GITHUB}/master/deploy/backup.sh#L3)`,
    ],
    [
      "a root-relative path is relative to the repository root; a folder link is a tree link",
      "[a](/docs/x.md) [b](../apps/server/)",
      "master",
      `[a](${GITHUB}/master/docs/x.md) [b](https://github.com/Artexs/email_assistant/tree/master/apps/server)`,
    ],
    [
      "a link text with a code span is still a link",
      "[the `x` file](../x.md)",
      "master",
      `[the \`x\` file](${GITHUB}/master/x.md)`,
    ],
  ])("%s", (_name, text, ref, out) => {
    expect(rewriteLinks(text, "deploy/README.md", ref)).toBe(out);
  });
  test("T3 an anchor link and an absolute URL stay", () => {
    const text = "[c](#update) [d](https://example.com/) [e](mailto:a@x.test) [f](//cdn.example.org/x)";
    expect(rewriteLinks(text, "deploy/README.md", "master")).toBe(text);
  });
  test("T4 a link that leaves the repository root throws and names the link and the source", () => {
    expect(() => rewriteLinks("[e](../../x.md)", "deploy/README.md", "master")).toThrow(
      "in_place_link_outside ../../x.md in deploy/README.md"
    );
    expect(() => rewriteLinks("[e](/../x.md)", "deploy/README.md", "master")).toThrow("in_place_link_outside");
    expect(() => rewriteLinks("[e](../..)", "deploy/README.md", "master")).toThrow(
      "in_place_link_outside ../.. in deploy/README.md"
    );
  });
  test("T5 a link to another in-place source becomes its site path, anchor kept", () => {
    expect(rewriteLinks("[r](../docs/release-checklist.md#step-2)", "deploy/README.md", "master")).toBe(
      "[r](/email_assistant/operate/release-checklist/#step-2)"
    );
    expect(rewriteLinks("[r](../deploy/README.md)", "docs/release-checklist.md", "master")).toBe(
      "[r](/email_assistant/operate/install-and-run/)"
    );
    expect(rewriteLinks("[r](README.md?x=1#a)", "deploy/README.md", "master")).toBe(
      "[r](/email_assistant/operate/install-and-run/?x=1#a)"
    );
  });
  test("an image, a title, an angle destination, a definition and a destination with parentheses are rewritten", () => {
    const text = [
      `![i](../docs/a.png "t")`,
      `[x](<../docs/a b.md>)`,
      `[ref]: ../docs/r.md`,
      `[p](../docs/a_(1).md)`,
    ].join("\n");
    expect(rewriteLinks(text, "deploy/README.md", "master")).toBe(
      [
        `![i](${GITHUB}/master/docs/a.png "t")`,
        `[x](<${GITHUB}/master/docs/a b.md>)`,
        `[ref]: ${GITHUB}/master/docs/r.md`,
        `[p](${GITHUB}/master/docs/a_(1).md)`,
      ].join("\n")
    );
  });
  test("a link in a code span or a code fence stays; a link after a code span is rewritten", () => {
    const text = [
      "`[a](../x.md)` and [b](../x.md)",
      "```md",
      "[c](../x.md)",
      "```",
      "~~~",
      "[d](../../y.md)",
      "~~~",
      "[e](../y.md)",
    ].join("\n");
    expect(rewriteLinks(text, "deploy/README.md", "master")).toBe(
      [
        `\`[a](../x.md)\` and [b](${GITHUB}/master/x.md)`,
        "```md",
        "[c](../x.md)",
        "```",
        "~~~",
        "[d](../../y.md)",
        "~~~",
        `[e](${GITHUB}/master/y.md)`,
      ].join("\n")
    );
  });
});

describe("splitSource", () => {
  test("the title is the first level-1 heading; the body is the source without that line", () => {
    expect(splitSource("# Title  \n\nText\n# Second", "a.md")).toEqual({ title: "Title", body: "\nText\n# Second" });
  });
  test("a `# ` line in a code fence is not the title", () => {
    expect(splitSource("```sh\n# comment\n```\n# Real", "a.md")).toEqual({
      title: "Real",
      body: "```sh\n# comment\n```",
    });
  });
  test("a source without a level-1 heading throws in_place_source <path>", () => {
    expect(() => splitSource("## Only\ntext", "deploy/README.md")).toThrow("in_place_source deploy/README.md");
  });
});

describe("docsGitRef", () => {
  test("DOCS_GIT_REF, else master", () => {
    expect(docsGitRef({})).toBe("master");
    expect(docsGitRef({ DOCS_GIT_REF: "" })).toBe("master");
    expect(docsGitRef({ DOCS_GIT_REF: "v0.1.0" })).toBe("v0.1.0");
    expect(docsGitRef({ DOCS_GIT_REF: "feature/x-1" })).toBe("feature/x-1");
  });
  test("a ref that would change the link target throws", () => {
    for (const ref of ["../x", "a b", "v1#x", "-x", "a?b", "v1/../x", "a..b"])
      expect(() => docsGitRef({ DOCS_GIT_REF: ref })).toThrow("in_place_ref");
  });
});

describe("the real sources", () => {
  test("T6 the first headings are the page titles", () => {
    const titles = IN_PLACE_PAGES.map((page) => readInPlaceSource(page, repoRoot()).title);
    expect(titles).toEqual(["Pilot host runbook", "Release checklist", "Changelog"]);
    expect(IN_PLACE_PAGES.map((page) => page.id)).toEqual([
      "operate/install-and-run",
      "operate/release-checklist",
      "changelog",
    ]);
  });
  test("every relative link of a source resolves inside the repository", () => {
    for (const page of IN_PLACE_PAGES) {
      const { body } = readInPlaceSource(page, repoRoot());
      expect(() => rewriteLinks(body, page.path, "master")).not.toThrow();
      expect(rewriteLinks(body, page.path, "master")).not.toMatch(/\]\(\.\.?\//);
    }
  });
  test("the source paths are absolute paths under the root", () => {
    for (const path of inPlaceSourcePaths()) expect(path.startsWith("/")).toBe(true);
    expect(inPlaceSourcePaths("/r")).toEqual([
      "/r/deploy/README.md",
      "/r/docs/release-checklist.md",
      "/r/CHANGELOG.md",
    ]);
  });
});

describe("inPlaceLoader", () => {
  let root = "";
  const saved = process.env.EA_DOCS_REPO_ROOT;
  const savedRef = process.env.DOCS_GIT_REF;
  const put = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "in-place-"));
    process.env.EA_DOCS_REPO_ROOT = root;
    delete process.env.DOCS_GIT_REF;
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    if (saved === undefined) delete process.env.EA_DOCS_REPO_ROOT;
    else process.env.EA_DOCS_REPO_ROOT = saved;
    if (savedRef === undefined) delete process.env.DOCS_GIT_REF;
    else process.env.DOCS_GIT_REF = savedRef;
  });

  const CHANGELOG = "# Changelog\n\n## [0.1.0] - 2026-11-20\n";
  const run = async () => {
    const events: string[] = [];
    const entries = new Map<string, Record<string, unknown>>();
    const base = { name: "base", load: async () => void events.push("base") } as unknown as Loader;
    const context = {
      parseData: async ({ id, data }: { id: string; data: { title: string } }) => {
        events.push(`parse ${id}`);
        return { ...data, parsed: true };
      },
      renderMarkdown: async (body: string) => ({ html: `<p>${body.length}</p>` }),
      store: {
        set: (entry: { id: string }) => void entries.set(entry.id, entry as unknown as Record<string, unknown>),
      },
    };
    await (inPlaceLoader(base).load as (c: unknown) => Promise<void>)(context);
    return { events, entries };
  };

  test("runs the base loader first, then sets one entry per source with title, body, filePath and rendered", async () => {
    put("deploy/README.md", "# Runbook\n\nSee [the list](../docs/release-checklist.md#x) and [code](../docs/a.md).\n");
    put("docs/release-checklist.md", "# Checklist\n\nBack to [runbook](../deploy/README.md).\n");
    put("CHANGELOG.md", CHANGELOG);
    const { events, entries } = await run();
    expect(events).toEqual([
      "base",
      "parse operate/install-and-run",
      "parse operate/release-checklist",
      "parse changelog",
    ]);
    const first = entries.get("operate/install-and-run");
    expect(first?.data).toEqual({ title: "Runbook", parsed: true });
    expect(first?.body).toBe(
      "\nSee [the list](/email_assistant/operate/release-checklist/#x) and [code](https://github.com/Artexs/email_assistant/blob/master/docs/a.md).\n"
    );
    expect(first?.filePath).toBe("../../deploy/README.md");
    expect(first?.rendered).toEqual({ html: `<p>${String(first?.body).length}</p>` });
    expect(entries.get("operate/release-checklist")?.body).toContain("(/email_assistant/operate/install-and-run/)");
  });
  test("DOCS_GIT_REF sets the ref of the GitHub links", async () => {
    process.env.DOCS_GIT_REF = "v0.1.0";
    put("deploy/README.md", "# A\n[x](../docs/a.md)\n");
    put("docs/release-checklist.md", "# B\n");
    put("CHANGELOG.md", CHANGELOG);
    expect((await run()).entries.get("operate/install-and-run")?.body).toContain("/blob/v0.1.0/docs/a.md");
  });
  test("a missing source file fails with in_place_source <path>", async () => {
    put("deploy/README.md", "# A\n");
    put("CHANGELOG.md", CHANGELOG);
    await expect(run()).rejects.toThrow("in_place_source docs/release-checklist.md");
  });
  test("T9 the changelog entry is built by the transform, then its links are rewritten", async () => {
    put("deploy/README.md", "# A\n");
    put("docs/release-checklist.md", "# B\n");
    put(
      "CHANGELOG.md",
      [
        "# Changelog",
        "",
        "Header text.",
        "",
        "## [Unreleased]",
        "",
        "### For users",
        "",
        "- en: Unreleased user item.",
        "  pl: Punkt.",
        "",
        "## [0.1.0] - 2026-11-20",
        "",
        "### Added",
        "",
        "- Operator item.",
        "",
        "### For users",
        "",
        "- en: See [the list](docs/release-checklist.md).",
        "  pl: Zobacz.",
        "",
      ].join("\n")
    );
    const { entries } = await run();
    const entry = entries.get("changelog");
    expect(entry?.data).toEqual({ title: "Changelog", parsed: true });
    expect(entry?.body).toBe(
      "\n## 0.1.0 - 2026-11-20\n\n- See [the list](/email_assistant/operate/release-checklist/).\n"
    );
    expect(entry?.filePath).toBe("../../CHANGELOG.md");
  });
  test("a changelog that does not parse fails the load with its error", async () => {
    put("deploy/README.md", "# A\n");
    put("docs/release-checklist.md", "# B\n");
    put("CHANGELOG.md", "# Changelog\n\n## [0.2] - 2026-12-01\n");
    await expect(run()).rejects.toThrow("changelog_heading (line 3)");
  });
  test("a source without a level-1 heading fails with in_place_source <path>", async () => {
    put("deploy/README.md", "no heading\n");
    put("docs/release-checklist.md", "# B\n");
    put("CHANGELOG.md", CHANGELOG);
    await expect(run()).rejects.toThrow("in_place_source deploy/README.md");
  });
  test("a link outside the repository fails the load", async () => {
    put("deploy/README.md", "# A\n[x](../../x.md)\n");
    put("docs/release-checklist.md", "# B\n");
    put("CHANGELOG.md", CHANGELOG);
    await expect(run()).rejects.toThrow("in_place_link_outside ../../x.md in deploy/README.md");
  });
});
