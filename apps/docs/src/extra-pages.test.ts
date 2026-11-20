import { describe, expect, test } from "bun:test";
import type { Loader } from "astro/loaders";

import { extraPagesLoader } from "./extra-pages";

const base: Loader = { name: "base", load: async () => {} };

describe("extraPagesLoader", () => {
  test("with no folder it is the base loader itself", () => {
    expect(extraPagesLoader(base, undefined)).toBe(base);
    expect(extraPagesLoader(base, "")).toBe(base);
  });

  test("with a folder it loads the base first, then adds the pages of the folder", () => {
    const loader = extraPagesLoader(base, "/tmp/somewhere");
    expect(loader).not.toBe(base);
    expect(loader.name).toBe("ea-extra-pages");
  });
});
