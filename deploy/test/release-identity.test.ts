import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

// F114 stage 05: the release name goes into the image (Dockerfile ARG and ENV), the build gets it from Compose, and the
// release scripts use the one-off service that `compose.yaml` has.

const deployDir = join(import.meta.dir, "..");
const read = (name: string): string => readFileSync(join(deployDir, name), "utf8");
// A script without its comment lines: the comments name db:rollback to say it is never used.
const code = (name: string): string =>
  read(name)
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");

describe("release identity files", () => {
  test("the Dockerfile has ARG EA_RELEASE=dev and ENV EA_RELEASE from it", () => {
    const dockerfile = read("Dockerfile");
    expect(dockerfile).toMatch(/^ARG EA_RELEASE=dev$/m);
    expect(dockerfile).toMatch(/^ENV EA_RELEASE=\$EA_RELEASE$/m);
  });

  test("compose.yaml passes EA_RELEASE to the server build with the default dev", () => {
    const compose = Bun.YAML.parse(read("compose.yaml")) as {
      services: Record<string, { build?: { args?: Record<string, string> } }>;
    };
    expect(compose.services.server?.build?.args?.EA_RELEASE).toBe("${EA_RELEASE:-dev}");
  });

  test("release.sh migrates through a service that compose.yaml has, with a profile, and never uses db:rollback", () => {
    const compose = Bun.YAML.parse(read("compose.yaml")) as { services: Record<string, { profiles?: string[] }> };
    const script = code("release.sh");
    const match = /run --rm -T (\w+) bun run db:migrate/.exec(script);
    expect(match).not.toBeNull();
    expect(Object.keys(compose.services)).toContain(match?.[1] ?? "");
    expect(script).not.toContain("db:rollback");
    expect(code("rollback.sh")).not.toContain("db:");
  });

  test("the state file is ignored and its folder is kept in git", () => {
    const ignore = readFileSync(join(deployDir, "..", ".gitignore"), "utf8");
    expect(ignore).toContain("deploy/release-state/state");
    expect(ignore).toContain("deploy/release-state/state.tmp");
    expect(readFileSync(join(deployDir, "release-state", ".gitkeep"), "utf8")).toBe("");
  });

  test("the scripts parse", () => {
    for (const name of ["release.sh", "rollback.sh", "release-lib.sh"]) {
      const result = Bun.spawnSync(["bash", "-n", join(deployDir, name)]);
      expect(result.exitCode, `${name}: ${result.stderr.toString()}`).toBe(0);
    }
  });
});
