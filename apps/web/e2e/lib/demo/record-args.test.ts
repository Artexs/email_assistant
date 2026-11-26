import { describe, expect, test } from "bun:test";

import {
  DEFAULT_OUT_DIR,
  MAX_VIDEO_BYTES,
  onPath,
  parseRecordArgs,
  preflightProblem,
  videoProblem,
  type RecordArgs,
} from "./record-args";

const APP = "postgres://app:x@127.0.0.1:5433/ea_f121_demo";
const MIGRATOR = "postgres://migrator:x@127.0.0.1:5433/ea_f121_demo";
const BASE_ENV = {
  PATH: "/usr/bin:/bin",
  DEMO_DATABASE_URL: APP,
  DEMO_MIGRATOR_DATABASE_URL: MIGRATOR,
  DATABASE_URL: "postgres://app:x@127.0.0.1:5433/ea_main",
  E2E_DATABASE_URL: "postgres://app:x@127.0.0.1:5433/ea_main_e2e",
};
const everything = () => true;
const args = (seed?: string): RecordArgs => ({ seed, out: "/tmp/out", setupOnly: false });

describe("parseRecordArgs", () => {
  test("no argument: no seed and the default folder under the working directory", () => {
    expect(parseRecordArgs([], "/repo")).toEqual({
      seed: undefined,
      out: `/repo/${DEFAULT_OUT_DIR}`,
      setupOnly: false,
    });
  });
  test("--seed and --out are made absolute", () => {
    expect(parseRecordArgs(["--seed", "s.json", "--out", "o"], "/repo")).toEqual({
      seed: "/repo/s.json",
      out: "/repo/o",
      setupOnly: false,
    });
  });
  test("--setup-only with a seed sets setupOnly, in any position", () => {
    expect(parseRecordArgs(["--setup-only", "--seed", "x.json"], "/repo")).toEqual({
      seed: "/repo/x.json",
      out: `/repo/${DEFAULT_OUT_DIR}`,
      setupOnly: true,
    });
    expect(parseRecordArgs(["--seed", "x.json", "--setup-only", "--out", "o"], "/repo")).toEqual({
      seed: "/repo/x.json",
      out: "/repo/o",
      setupOnly: true,
    });
  });
  test("--setup-only without a seed is setup_only_needs_seed; repeated it is bad_args", () => {
    expect(parseRecordArgs(["--setup-only"])).toBe("setup_only_needs_seed");
    expect(parseRecordArgs(["--setup-only", "--out", "o"])).toBe("setup_only_needs_seed");
    expect(parseRecordArgs(["--setup-only", "--seed", "x.json", "--setup-only"])).toBe("bad_args --setup-only");
  });
  test("an unknown flag, a missing value or a repeated flag is bad_args", () => {
    expect(parseRecordArgs(["--other", "x"])).toBe("bad_args --other");
    expect(parseRecordArgs(["--seed"])).toBe("bad_args --seed");
    expect(parseRecordArgs(["--out", "a", "--out", "b"])).toBe("bad_args --out");
    expect(parseRecordArgs(["stray"])).toBe("bad_args stray");
  });
});

describe("onPath", () => {
  test("finds a command in one folder of the PATH value and not in an empty one", () => {
    const only = (path: string) => path === "/opt/bin/ffmpeg";
    expect(onPath("ffmpeg", "/usr/bin:/opt/bin", only)).toBe(true);
    expect(onPath("ffmpeg", "/usr/bin", only)).toBe(false);
    expect(onPath("ffmpeg", "", only)).toBe(false);
    expect(onPath("ffmpeg", undefined, only)).toBe(false);
  });
});

describe("preflightProblem", () => {
  test("a good setup passes; no seed is allowed", () => {
    expect(preflightProblem(args(), { env: BASE_ENV, exists: everything })).toBeNull();
    expect(preflightProblem(args("/no/such.json"), { env: BASE_ENV, exists: everything })).toBeNull();
  });
  test("a seed file that does not exist is seed_missing", () => {
    const exists = (path: string) => path !== "/no/such.json";
    expect(preflightProblem(args("/no/such.json"), { env: BASE_ENV, exists })).toBe("seed_missing");
  });
  test("a PATH without ffmpeg is ffmpeg_missing, and it comes before the seed check", () => {
    const exists = (path: string) => !path.endsWith("/ffmpeg") && path !== "/no/such.json";
    expect(preflightProblem(args("/no/such.json"), { env: BASE_ENV, exists })).toBe("ffmpeg_missing");
  });
  test("an empty or missing demo key is demo_db_missing", () => {
    expect(preflightProblem(args(), { env: { ...BASE_ENV, DEMO_DATABASE_URL: "" }, exists: everything })).toBe(
      "demo_db_missing"
    );
    expect(
      preflightProblem(args(), { env: { ...BASE_ENV, DEMO_MIGRATOR_DATABASE_URL: undefined }, exists: everything })
    ).toBe("demo_db_missing");
  });
  test("a demo database that is another database of the checkout, or has no _demo name, is demo_db_refused", () => {
    const refused = (env: Record<string, string>) =>
      preflightProblem(args(), { env: { ...BASE_ENV, ...env }, exists: everything });
    expect(
      refused({ DEMO_DATABASE_URL: BASE_ENV.DATABASE_URL, DEMO_MIGRATOR_DATABASE_URL: BASE_ENV.DATABASE_URL })
    ).toBe("demo_db_refused");
    expect(refused({ DEMO_MIGRATOR_DATABASE_URL: "postgres://migrator:x@127.0.0.1:5433/ea_f121" })).toBe(
      "demo_db_refused"
    );
    expect(refused({ DEMO_DATABASE_URL: "postgres://app:x@127.0.0.1:5433/ea_main_e2e" })).toBe("demo_db_refused");
  });
});

describe("videoProblem", () => {
  test("100 to 130 seconds and at most 15 MB pass", () => {
    expect(videoProblem({ bytes: 1_000_000, seconds: 100 })).toBeNull();
    expect(videoProblem({ bytes: MAX_VIDEO_BYTES, seconds: 130 })).toBeNull();
  });
  test("a larger or a shorter or a longer video fails", () => {
    expect(videoProblem({ bytes: MAX_VIDEO_BYTES + 1, seconds: 116 })).toBe(`video_too_large ${MAX_VIDEO_BYTES + 1}`);
    expect(videoProblem({ bytes: 1, seconds: 99.9 })).toBe("video_length 99.9");
    expect(videoProblem({ bytes: 1, seconds: 130.1 })).toBe("video_length 130.1");
    expect(videoProblem({ bytes: 1, seconds: Number.NaN })).toBe("video_length NaN");
  });
});
