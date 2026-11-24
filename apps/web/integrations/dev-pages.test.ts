import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { InjectedRoute } from "astro";

import devPages from "./dev-pages";

function injected(env: Record<string, string | undefined>): InjectedRoute[] {
  const routes: InjectedRoute[] = [];
  const hook = devPages(env).hooks["astro:config:setup"];
  if (hook === undefined) throw new Error("no config hook");
  void hook({ injectRoute: (route: InjectedRoute) => routes.push(route) } as never);
  return routes;
}

describe("devPages", () => {
  test("EA_DEV_PAGES=1 injects the one route /dev/patterns", () => {
    const routes = injected({ EA_DEV_PAGES: "1" });
    expect(routes.map((route) => route.pattern)).toEqual(["/dev/patterns"]);
    expect(String(routes[0].entrypoint).endsWith("/src/dev/patterns.astro")).toBe(true);
  });

  test.each([{}, { EA_DEV_PAGES: "" }, { EA_DEV_PAGES: "0" }, { EA_DEV_PAGES: "true" }])(
    "env %o injects no route",
    (env) => {
      expect(injected(env)).toEqual([]);
    }
  );
});

describe("the image and the release do not build the dev pages", () => {
  const DEPLOY = join(import.meta.dirname, "../../../deploy");
  test.each(["Dockerfile", "Dockerfile.sim", "release.sh", "release-lib.sh"])(
    "deploy/%s names neither the variable nor the dev build script",
    (file) => {
      const text = readFileSync(join(DEPLOY, file), "utf8");
      expect(text).not.toContain("EA_DEV_PAGES");
      expect(text).not.toContain("web:build:dev");
    }
  );
});
