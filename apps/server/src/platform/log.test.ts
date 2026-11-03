import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";

import { createLog, setLogLevel } from "./log";

let out: ReturnType<typeof spyOn>;
let err: ReturnType<typeof spyOn>;

beforeEach(() => {
  setLogLevel("info");
  out = spyOn(console, "log").mockImplementation(() => undefined);
  err = spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  out.mockRestore();
  err.mockRestore();
  setLogLevel("info");
});

test("info prints a line that starts with the module prefix", () => {
  createLog("tenancy").info("x");
  expect(out).toHaveBeenCalledTimes(1);
  expect(String(out.mock.calls[0]?.[0]).startsWith("[tenancy]")).toBe(true);
});

test("debug is dropped at the default level", () => {
  createLog("tenancy").debug("x");
  expect(out).not.toHaveBeenCalled();
});

test("a higher level drops info and keeps warn on stderr", () => {
  setLogLevel("warn");
  const log = createLog("tenancy");
  log.info("x");
  expect(out).not.toHaveBeenCalled();
  log.warn("y");
  expect(err).toHaveBeenCalledTimes(1);
  expect(String(err.mock.calls[0]?.[0]).startsWith("[tenancy]")).toBe(true);
});
