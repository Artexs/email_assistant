import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { UsageError } from "@ea/core";
import { afterEach, describe, expect, test } from "bun:test";

import { docsTestPort, e2ePorts, loadRepoDotEnv, parseE2eJobEnvArgs, portFromEnv } from "./e2e-job-env-args";

describe("parseE2eJobEnvArgs", () => {
  test("parses the job name", () => {
    expect(parseE2eJobEnvArgs(["--job-name", "2026-11-19-1ac5ae68"])).toEqual({ jobName: "2026-11-19-1ac5ae68" });
  });

  test.each([[[]], [["--job-name", ""]]])("refuses the arguments %j with a usage error", (argv) => {
    expect(() => parseE2eJobEnvArgs(argv)).toThrow(new UsageError("--job-name is needed"));
  });

  test.each([[["--job-name"]], [["--job-name", "x", "extra"]], [["--no-such-flag"]]])(
    "refuses the arguments %j with a parseArgs usage error",
    (argv) => {
      expect(() => parseE2eJobEnvArgs(argv)).toThrow(
        expect.objectContaining({ code: expect.stringMatching(/^ERR_PARSE_ARGS_/) })
      );
    }
  );
});

describe("portFromEnv", () => {
  test("unset or empty gives the fallback", () => {
    expect(portFromEnv(undefined, "E2E_PORT", 8081)).toBe(8081);
    expect(portFromEnv("", "E2E_PORT", 8081)).toBe(8081);
  });

  test("a decimal integer in range passes", () => {
    expect(portFromEnv("28560", "E2E_PORT", 8081)).toBe(28560);
    expect(portFromEnv("1024", "E2E_PORT", 8081)).toBe(1024);
    expect(portFromEnv("65535", "E2E_PORT", 8081)).toBe(65535);
  });

  test.each(["80", "1023", "65536", "70000", "abc", "285 60", "28560.5", "-28560", "0x7000"])(
    "%j throws and names the key",
    (value) => {
      expect(() => portFromEnv(value, "E2E_PORT", 8081)).toThrow("E2E_PORT");
    }
  );
});

describe("e2ePorts and docsTestPort", () => {
  test("no env gives the fixed ports", () => {
    expect(e2ePorts({})).toEqual({ app: 8081, telegram: 8092 });
    expect(docsTestPort({})).toBe(8093);
  });

  test("env sets each port", () => {
    expect(e2ePorts({ E2E_PORT: "28560", E2E_TELEGRAM_PORT: "28561" })).toEqual({ app: 28560, telegram: 28561 });
    expect(docsTestPort({ DOCS_TEST_PORT: "28562" })).toBe(28562);
  });

  test("equal panel ports throw", () => {
    expect(() => e2ePorts({ E2E_PORT: "28560", E2E_TELEGRAM_PORT: "28560" })).toThrow("must differ");
  });

  test("a bad key names itself", () => {
    expect(() => e2ePorts({ E2E_TELEGRAM_PORT: "80" })).toThrow("E2E_TELEGRAM_PORT");
    expect(() => docsTestPort({ DOCS_TEST_PORT: "x" })).toThrow("DOCS_TEST_PORT");
  });
});

describe("loadRepoDotEnv", () => {
  const probe = (): string | undefined => process.env.F136_PROBE;
  let dir = "";
  afterEach(() => {
    delete process.env.F136_PROBE;
    if (dir !== "") rmSync(dir, { recursive: true, force: true });
    dir = "";
  });

  test("a set key keeps its value, an unset key takes the file value", () => {
    dir = mkdtempSync(join(tmpdir(), "f136-env-"));
    writeFileSync(join(dir, ".env"), "F136_PROBE=file\n");
    process.env.F136_PROBE = "process";
    loadRepoDotEnv(dir);
    expect(probe()).toBe("process");
    delete process.env.F136_PROBE;
    loadRepoDotEnv(dir);
    expect(probe()).toBe("file");
  });

  test("a folder with no .env does nothing", () => {
    dir = mkdtempSync(join(tmpdir(), "f136-env-"));
    expect(() => loadRepoDotEnv(dir)).not.toThrow();
  });
});
