import { describe, expect, mock, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "astro/zod";
import type { Loader } from "astro/loaders";

import {
  capabilityNames,
  englishId,
  frontMatterLoader,
  frontMatterProblem,
  frontMatterSchema,
  isUserPage,
  POLISH_SET,
  USER_SECTIONS,
} from "./front-matter";

const known = new Set(["sync", "rules"]);

describe("front matter capabilities", () => {
  test("T1 an existing capability passes; a missing one fails with the page id", () => {
    expect(frontMatterProblem("start/first-steps", { capabilities: ["sync"] }, known)).toBeNull();
    expect(frontMatterProblem("start/first-steps", { capabilities: ["nope"] }, known)).toBe(
      "front_matter capabilities start/first-steps"
    );
    expect(frontMatterProblem("start/first-steps", { capabilities: ["sync", "nope"] }, known)).toBe(
      "front_matter capabilities start/first-steps"
    );
  });
  test("T1 the real docs/capabilities folder holds `sync`, and not `nope`", () => {
    const names = capabilityNames();
    expect(names.has("sync")).toBe(true);
    expect(names.has("nope")).toBe(false);
    expect(names.has("README")).toBe(false);
  });
  test("T2 a user page without capabilities fails, in every user section and under pl/", () => {
    for (const section of USER_SECTIONS) {
      expect(frontMatterProblem(`${section}/x`, {}, known)).toBe(`front_matter capabilities ${section}/x`);
      expect(frontMatterProblem(`pl/${section}/x`, { capabilities: [] }, known)).toBe(
        `front_matter capabilities pl/${section}/x`
      );
    }
  });
  test("T2 an operator page, the home page and a section-like name need none", () => {
    expect(frontMatterProblem("operate/install-and-run", {}, known)).toBeNull();
    expect(frontMatterProblem("index", {}, known)).toBeNull();
    expect(frontMatterProblem("pl/index", {}, known)).toBeNull();
    expect(frontMatterProblem("starting/x", {}, known)).toBeNull();
    expect(frontMatterProblem("faqs/x", {}, known)).toBeNull();
  });
  test("a non-user page that names a missing capability fails", () => {
    expect(frontMatterProblem("operate/x", { capabilities: ["nope"] }, known)).toBe(
      "front_matter capabilities operate/x"
    );
  });
  test("page id helpers", () => {
    expect(englishId("pl/how-to/x")).toBe("how-to/x");
    expect(englishId("how-to/x")).toBe("how-to/x");
    expect(isUserPage("pl/faq")).toBe(true);
    expect(isUserPage("pl/index")).toBe(false);
  });
  test("POLISH_SET holds the home page for now", () => {
    expect([...POLISH_SET]).toEqual(["index"]);
  });
});

describe("front matter schema", () => {
  test("the three fields are optional; sourceHash is 16 lowercase hex", () => {
    expect(frontMatterSchema.safeParse({}).success).toBe(true);
    expect(
      frontMatterSchema.safeParse({ capabilities: ["sync"], source: "start", sourceHash: "0123456789abcdef" }).success
    ).toBe(true);
    for (const bad of ["0123456789ABCDEF", "0123456789abcde", "0123456789abcdef0", "xyz"]) {
      expect(frontMatterSchema.safeParse({ sourceHash: bad }).success).toBe(false);
    }
    expect(frontMatterSchema.safeParse({ capabilities: "sync" }).success).toBe(false);
  });
});

describe("frontMatterLoader", () => {
  const fakeBase = (entries: Record<string, unknown>): Loader => ({
    name: "fake",
    load: async (context) => {
      for (const [id, data] of Object.entries(entries))
        context.store.set({ id, data: data as Record<string, unknown> });
    },
  });
  const run = async (loader: Loader, entries: Map<string, { data: unknown }>) => {
    const context = {
      store: {
        set: ({ id, data }: { id: string; data: unknown }) => void entries.set(id, { data }),
        entries: () => [...entries.entries()],
      },
    };
    await loader.load(context as never);
  };

  test("a how-to page without capabilities fails the load; a page with one passes", async () => {
    const root = mkdtempSync(join(tmpdir(), "docs-fm-"));
    try {
      mkdirSync(join(root, "docs/capabilities"), { recursive: true });
      writeFileSync(join(root, "docs/capabilities/sync.md"), "# Sync\n");
      const good = frontMatterLoader(fakeBase({ "how-to/a": { capabilities: ["sync"] }, index: {} }), () => root);
      await run(good, new Map());
      const bad = frontMatterLoader(fakeBase({ "how-to/a": { title: "A" } }), () => root);
      await expect(run(bad, new Map())).rejects.toThrow("front_matter capabilities how-to/a");
      const missing = frontMatterLoader(fakeBase({ "faq/a": { capabilities: ["nope"] } }), () => root);
      await expect(run(missing, new Map())).rejects.toThrow("front_matter capabilities faq/a");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  test("the base loader runs first", async () => {
    const order: string[] = [];
    const loader = frontMatterLoader({ name: "b", load: async () => void order.push("base") }, () => {
      order.push("root");
      return "/nonexistent";
    });
    await run(loader, new Map());
    expect(order).toEqual(["base", "root"]);
  });
});

describe("content.config.ts", () => {
  test("the docs collection uses the front matter loader and the extended schema", async () => {
    mock.module("astro:content", () => ({ defineCollection: (definition: unknown) => definition }));
    const { collections } = (await import("./content.config")) as {
      collections: { docs: { loader: Loader; schema: (context: { image: () => unknown }) => z.ZodType } };
    };
    expect(collections.docs.loader.name).toBe("ea-front-matter");
    const schema = collections.docs.schema({ image: () => z.any() });
    expect(
      schema.safeParse({ title: "T", capabilities: ["sync"], source: "start", sourceHash: "0123456789abcdef" }).success
    ).toBe(true);
    expect(schema.safeParse({ title: "T", sourceHash: "nothex" }).success).toBe(false);
    expect(schema.safeParse({ title: "T", capabilities: "sync" }).success).toBe(false);
  });
});
