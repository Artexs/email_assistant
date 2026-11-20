// Extra pages for the docs collection, read from a folder outside the repository (tests only).
// `EA_DOCS_EXTRA_PAGES_DIR` names the folder. The build test for `<Shot>` puts its fixture page there, so no test
// writes a page into `src/content/docs` while other tests scan that folder.
import { glob } from "astro/loaders";
import type { Loader } from "astro/loaders";

const PATTERN = "**/[^_]*.{md,mdx}";

// The glob loader deletes every store entry it did not load itself. A store view with no keys at the start keeps the entries of `base`.
function keepOthers<T extends { keys(): Iterable<string> }>(store: T): T {
  return new Proxy(store, {
    get(target, prop) {
      if (prop === "keys") return () => [][Symbol.iterator]();
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export function extraPagesLoader(base: Loader, dir: string | undefined = process.env.EA_DOCS_EXTRA_PAGES_DIR): Loader {
  if (dir === undefined || dir === "") return base;
  return {
    name: "ea-extra-pages",
    load: async (context) => {
      await base.load(context);
      await glob({ base: dir, pattern: PATTERN }).load({ ...context, store: keepOthers(context.store) });
    },
  };
}
