import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, test } from "bun:test";

import {
  type Layers,
  findCycle,
  forbiddenEdges,
  formatFor,
  graphPaths,
  loadLayers,
  readModuleGraph,
  renderGraphMarkdown,
} from "../scripts/module-graph-build";

const paths = graphPaths(path.resolve(import.meta.dir, "../../../.."));
const layers = loadLayers(paths.layersFile);
const graph = readModuleGraph(paths.modulesDir);

describe("layers.json", () => {
  test("lists exactly the module folders, each in one layer", () => {
    const listed = layers.layers.flat();
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual(graph.modules);
  });

  test("each sameLayerEdges entry joins two modules of one layer, once", () => {
    const layerOf = new Map(layers.layers.flatMap((names, index) => names.map((name) => [name, index] as const)));
    const keys = layers.sameLayerEdges.map(({ from, to }) => `${from} ${to}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const { from, to } of layers.sameLayerEdges) {
      expect(from).not.toBe(to);
      expect(layerOf.get(from)).toBeDefined();
      expect(layerOf.get(from)).toBe(layerOf.get(to));
    }
  });

  test("sameLayerEdges has no cycle", () => {
    expect(findCycle(layers.sameLayerEdges.map(({ from, to }) => [from, to] as const))).toBeNull();
  });

  test("each rootDeepImportExceptions file exists under apps/server/src", () => {
    const srcDir = path.join(paths.modulesDir, "..");
    for (const { file } of layers.rootDeepImportExceptions) {
      expect({ file, exists: existsSync(path.join(srcDir, file)) }).toEqual({ file, exists: true });
    }
  });
});

describe("module graph of the code", () => {
  test("every edge goes to a lower layer or is a named same-layer edge", () => {
    const forbidden = forbiddenEdges(graph.edges, layers);
    const message = `forbidden edges: ${JSON.stringify(forbidden)}. Add the edge to a lower layer, or name it in sameLayerEdges of apps/server/src/modules/layers.json`;
    expect(forbidden, message).toEqual([]);
  });

  test("has no cycle", () => {
    expect(findCycle(graph.edges)).toBeNull();
  });

  test("docs/diagrams/module-graph.json matches the code", () => {
    const committed = JSON.parse(readFileSync(paths.json, "utf8")) as { modules: string[]; edges: string[][] };
    expect({ modules: committed.modules, edges: committed.edges }, "run bun run graph:modules").toEqual({
      modules: graph.modules,
      edges: graph.edges.map(([from, to]) => [from, to]),
    });
  });

  test("docs/diagrams/module-graph.md matches the code", async () => {
    const expected = await formatFor(paths.markdown, renderGraphMarkdown(graph, layers));
    expect(readFileSync(paths.markdown, "utf8") === expected, "run bun run graph:modules").toBe(true);
  });
});

describe("graph helpers", () => {
  const fixture: Layers = {
    layers: [["a"], ["b", "c"]],
    sameLayerEdges: [{ from: "b", to: "c", why: "test" }],
    rootDeepImportExceptions: [],
  };

  test("forbiddenEdges keeps upward edges, unlisted same-layer edges and unplaced names", () => {
    const edges = [
      ["b", "a"],
      ["b", "c"],
      ["c", "b"],
      ["a", "b"],
    ] as const;
    expect(forbiddenEdges(edges, fixture)).toEqual([
      ["c", "b"],
      ["a", "b"],
    ]);
    expect(forbiddenEdges([["a", "z"]], fixture)).toEqual([["a", "z"]]);
  });

  test("findCycle returns the cycle path, or null", () => {
    expect(
      findCycle([
        ["a", "b"],
        ["b", "c"],
        ["c", "a"],
      ])
    ).toEqual(["a", "b", "c", "a"]);
    expect(
      findCycle([
        ["a", "b"],
        ["b", "c"],
      ])
    ).toBeNull();
  });

  const tmp = mkdtempSync(path.join(os.tmpdir(), "f086-graph-"));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  test("readModuleGraph counts cross-module imports in source files only", () => {
    const files: Record<string, string> = {
      "x/index.ts": `export * from "./repo";`,
      "x/repo.ts": `import { a } from "../y/repo";\nimport { db } from "../../platform/db";\nexport const b = [a, db];\n`,
      "y/index.ts": `export const a = 1;\n`,
      "y/repo.ts": `export const a = 1;\n`,
      "y/a.test.ts": `import { b } from "../x";\n`,
    };
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(tmp, name)), { recursive: true });
      writeFileSync(path.join(tmp, name), text);
    }
    expect(readModuleGraph(tmp)).toEqual({ modules: ["x", "y"], edges: [["x", "y"]] });
  });
});
