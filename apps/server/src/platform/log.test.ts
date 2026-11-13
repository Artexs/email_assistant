import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import {
  createLog,
  droppedLogFields,
  logFormatFromEnv,
  setLogFormat,
  setLogLevel,
  withLogContext,
  type LogFields,
} from "./log";

let out: ReturnType<typeof spyOn>;
let err: ReturnType<typeof spyOn>;

const M = "7d0c2a8e-5b1f-4c3d-9e2a-0f1b2c3d4e5f";
const O = "3b9c1e7a-2d4f-4a60-8b1c-5e6f7a8b9c0d";
const R = "0f0e0d0c-0b0a-4908-8706-050403020100";
const Q = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

const jsonLine = (spy: ReturnType<typeof spyOn>): Record<string, unknown> =>
  JSON.parse(String(spy.mock.calls.at(-1)?.[0])) as Record<string, unknown>;

beforeEach(() => {
  setLogLevel("info");
  setLogFormat("text");
  out = spyOn(console, "log").mockImplementation(() => undefined);
  err = spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  out.mockRestore();
  err.mockRestore();
  setLogLevel("info");
  setLogFormat("text");
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

test("a JSON line has the base keys, then the fields, in order", () => {
  setLogFormat("json");
  createLog("mail").info("sync_done", { mailbox_id: M, count: 3 });
  expect(out).toHaveBeenCalledTimes(1);
  expect(out.mock.calls[0]).toHaveLength(1);
  const line = jsonLine(out);
  expect(Object.keys(line)).toEqual(["time", "level", "module", "event", "msg", "mailbox_id", "count"]);
  expect(line).toMatchObject({
    level: "info",
    module: "mail",
    event: "sync_done",
    msg: "sync_done",
    mailbox_id: M,
    count: 3,
  });
  expect(String(line.time)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

test("an unknown field is dropped and counted, and its value is not printed", () => {
  setLogFormat("json");
  createLog("mail").info("sync_done", { subject: "MARKER-SUBJ" } as never);
  const line = jsonLine(out);
  expect(line).not.toHaveProperty("subject");
  expect(line.dropped_fields).toBe(1);
  expect(String(out.mock.calls[0]?.[0])).not.toContain("MARKER-SUBJ");
});

test("a string of 65 characters is dropped, one of 64 is kept", () => {
  setLogFormat("json");
  const log = createLog("mail");
  log.info("sync_done", { reason: "a".repeat(65) });
  expect(jsonLine(out)).not.toHaveProperty("reason");
  expect(jsonLine(out).dropped_fields).toBe(1);
  log.info("sync_done", { reason: "a".repeat(64) });
  expect(jsonLine(out).reason).toBe("a".repeat(64));
  expect(jsonLine(out)).not.toHaveProperty("dropped_fields");
});

test.each<[string, unknown, boolean]>([
  ["a space", { reason: "has space" }, false],
  ["an address", { reason: "x@y.test" }, false],
  ["a URL", { reason: "https://h.test/a" }, false],
  ["a newline", { reason: "line\nbreak" }, false],
  ["NaN", { count: Number.NaN }, false],
  ["Infinity", { count: Number.POSITIVE_INFINITY }, false],
  ["an Error", { error: new Error("MARKER-ERR") }, false],
  ["an array", { reason: ["a"] }, false],
  ["an object", { reason: { a: 1 } }, false],
  ["a bigint", { count: 10n }, false],
  ["null", { status: null }, true],
  ["a route with a param", { route: "/api/mailboxes/:id" }, true],
  ["a route with a star", { route: "/api/*" }, true],
  ["an auth route", { route: "/api/auth/*" }, true],
  ["a config key", { config_key: "SEND_TEST_ADDRESSES" }, true],
  ["an LLM role", { role: "judge" }, true],
  ["an unlisted name key", { key: "x" }, false],
  ["a model", { model: "gemini-3.5-flash-lite" }, true],
  ["a user id", { user_id: M }, true],
  ["an unlisted name ok", { ok: true }, false],
  ["an empty string", { reason: "" }, true],
])("value shape: %s", (_name, fields, kept) => {
  setLogFormat("json");
  createLog("mail").info("sync_done", fields as LogFields);
  const line = jsonLine(out);
  const name = Object.keys(fields as object)[0] as string;
  if (kept) {
    expect(line).toHaveProperty(name);
    expect(line).not.toHaveProperty("dropped_fields");
  } else {
    expect(line).not.toHaveProperty(name);
    expect(line.dropped_fields).toBe(1);
    expect(String(out.mock.calls[0]?.[0])).not.toContain("MARKER-ERR");
  }
  if (name === "status") {
    expect(line.status).toBeNull();
  }
});

test("an undefined value is left out and not counted", () => {
  setLogFormat("json");
  createLog("mail").info("sync_done", { code: undefined, count: 1 });
  const line = jsonLine(out);
  expect(line).not.toHaveProperty("code");
  expect(line).not.toHaveProperty("dropped_fields");
});

test("a base key cannot be replaced", () => {
  setLogFormat("json");
  createLog("mail").info("sync_done", { msg: "x", level: "error" } as never);
  const line = jsonLine(out);
  expect(line.msg).toBe("sync_done");
  expect(line.level).toBe("info");
  expect(line.dropped_fields).toBe(2);
});

test("the drop total counts every dropped field", () => {
  const before = droppedLogFields();
  const log = createLog("mail");
  log.info("sync_done", { a: 1, b: 2 } as never);
  log.info("sync_done", { c: 3 } as never);
  expect(droppedLogFields() - before).toBe(3);
});

test("the text event form prints the prefix and key=value pairs", () => {
  const log = createLog("mail");
  log.info("sync_done", { mailbox_id: M, count: 3 });
  expect(out.mock.calls[0]).toEqual(["[mail]", `sync_done mailbox_id=${M} count=3`]);
  log.info("sync_done", { count: 3, subject: "x" } as never);
  expect(out.mock.calls[1]).toEqual(["[mail]", "sync_done count=3 dropped_fields=1"]);
  log.info("sync_done", { status: null });
  expect(out.mock.calls[2]).toEqual(["[mail]", "sync_done status=null"]);
});

test("the old form in text prints as before", () => {
  createLog("mail").info("sync 12 done:", 5);
  expect(out.mock.calls[0]).toEqual(["[mail]", "sync 12 done:", 5]);
});

test("the old form in JSON is one legacy_text line", () => {
  setLogFormat("json");
  createLog("mail").warn("sync %s failed", "box-1", 3);
  expect(err).toHaveBeenCalledTimes(1);
  const line = jsonLine(err);
  expect(line).toMatchObject({ event: "legacy_text", msg: "sync box-1 failed 3", level: "warn" });
  expect(Object.keys(line)).toEqual(["time", "level", "module", "event", "msg"]);
});

test.each<[unknown[], string]>([
  [["sync_done"], "sync_done"],
  [["sync_done", { count: 1 }], "sync_done"],
  [["Sync_done"], "legacy_text"],
  [["sync done"], "legacy_text"],
  [["sync_done", "x"], "legacy_text"],
  [["sync_done", { count: 1 }, 2], "legacy_text"],
  [["sync_done", new Error("e")], "legacy_text"],
  [["sync_done", Object.create(null)], "sync_done"],
  [["a".repeat(65)], "legacy_text"],
])("event or old form: %j", (args, event) => {
  setLogFormat("json");
  (createLog("mail").info as (...a: unknown[]) => void)(...args);
  expect(jsonLine(out).event).toBe(event);
});

test.each<["json" | "text"]>([["json"], ["text"]])("streams and levels in %s", (format) => {
  setLogFormat(format);
  const log = createLog("mail");
  log.debug("a_event");
  log.info("a_event");
  expect(out).toHaveBeenCalledTimes(1);
  log.warn("a_event");
  log.error("a_event");
  expect(err).toHaveBeenCalledTimes(2);
  setLogLevel("warn");
  log.info("a_event");
  expect(out).toHaveBeenCalledTimes(1);
  setLogLevel("debug");
  log.debug("a_event");
  expect(out).toHaveBeenCalledTimes(2);
});

test("logFormatFromEnv gives json only for the exact value json", () => {
  expect(logFormatFromEnv({ LOG_FORMAT: "json" })).toBe("json");
  expect(logFormatFromEnv({ LOG_FORMAT: "text" })).toBe("text");
  expect(logFormatFromEnv({})).toBe("text");
  expect(logFormatFromEnv({ LOG_FORMAT: "JSON" })).toBe("text");
  expect(logFormatFromEnv({ LOG_FORMAT: "" })).toBe("text");
});

test("a call writes one line, also with a newline in an old-form argument", () => {
  setLogFormat("json");
  createLog("mail").info("sync %s", "a\nb");
  expect(out).toHaveBeenCalledTimes(1);
  expect(String(out.mock.calls[0]?.[0]).includes("\n")).toBe(false);
});

test("a throwing getter is a drop and does not throw", () => {
  setLogFormat("json");
  const fields = {
    get count(): number {
      throw new Error("g");
    },
  };
  expect(() => createLog("mail").info("sync_done", fields as never)).not.toThrow();
  expect(jsonLine(out).dropped_fields).toBe(1);
});

describe("context", () => {
  const log = createLog("mail");
  const keysAfterMsg = (spy: ReturnType<typeof spyOn>): string[] => Object.keys(jsonLine(spy)).slice(5);

  beforeEach(() => {
    setLogFormat("json");
  });

  test("a line inside a run carries job and run_id, also after await", async () => {
    await withLogContext({ job: "mail.sync", run_id: R }, async () => {
      await Bun.sleep(1);
      log.info("sync_done", { count: 1 });
    });
    const line = jsonLine(out);
    expect(Object.keys(line)).toEqual(["time", "level", "module", "event", "msg", "job", "run_id", "count"]);
    expect(line.job).toBe("mail.sync");
    expect(line.run_id).toBe(R);
  });

  test("a line outside any context has no context keys", () => {
    log.info("a");
    const line = jsonLine(out);
    expect(line).not.toHaveProperty("job");
    expect(line).not.toHaveProperty("run_id");
    expect(line).not.toHaveProperty("request_id");
  });

  test("a nested context adds keys and ends with its call", async () => {
    await withLogContext({ job: "mail.sync", run_id: R }, async () => {
      await withLogContext({ request_id: Q }, async () => log.info("a"));
      expect(keysAfterMsg(out)).toEqual(["job", "run_id", "request_id"]);
      log.info("b");
      expect(jsonLine(out)).not.toHaveProperty("request_id");
    });
  });

  test("an outer context key wins over a nested one, with no drop", () => {
    withLogContext({ run_id: R }, () => {
      withLogContext({ run_id: Q }, () => log.info("a"));
    });
    const line = jsonLine(out);
    expect(line.run_id).toBe(R);
    expect(line).not.toHaveProperty("dropped_fields");
  });

  test("a call cannot replace a context key; outside a context it may name the job", () => {
    withLogContext({ run_id: R }, () => log.info("a", { run_id: Q }));
    let line = jsonLine(out);
    expect(line.run_id).toBe(R);
    expect(line.dropped_fields).toBe(1);
    log.info("a", { job: "mail.sync" });
    line = jsonLine(out);
    expect(line.job).toBe("mail.sync");
    expect(line).not.toHaveProperty("dropped_fields");
  });

  test("two runs at once do not mix", async () => {
    await Promise.all([
      withLogContext({ run_id: R }, async () => {
        await Bun.sleep(5);
        log.info("a");
      }),
      withLogContext({ request_id: Q }, async () => {
        await Bun.sleep(1);
        log.info("b");
      }),
    ]);
    const lines = out.mock.calls.map((call: unknown[]) => JSON.parse(String(call[0])) as Record<string, unknown>);
    const a = lines.find((line: Record<string, unknown>) => line.event === "a");
    const b = lines.find((line: Record<string, unknown>) => line.event === "b");
    expect(b?.request_id).toBe(Q);
    expect(b).not.toHaveProperty("run_id");
    expect(a?.run_id).toBe(R);
    expect(a).not.toHaveProperty("request_id");
  });

  test("a child logger adds its fields before the call fields", () => {
    createLog("mail").with({ org_id: O }).info("a", { mailbox_id: M });
    expect(keysAfterMsg(out)).toEqual(["org_id", "mailbox_id"]);
    log.with({ org_id: O }).with({ mailbox_id: M }).info("a");
    expect(keysAfterMsg(out)).toEqual(["org_id", "mailbox_id"]);
    log.with({ subject: "s" } as never).info("a");
    const line = jsonLine(out);
    expect(line).not.toHaveProperty("subject");
    expect(line.dropped_fields).toBe(1);
  });

  test("a child logger in a run writes context, then child fields", () => {
    withLogContext({ job: "mail.sync", run_id: R }, () => log.with({ org_id: O }).info("a"));
    expect(keysAfterMsg(out)).toEqual(["job", "run_id", "org_id"]);
  });

  test("the old form in JSON carries the context", () => {
    withLogContext({ run_id: R }, () => log.info("free text 1"));
    const line = jsonLine(out);
    expect(line.event).toBe("legacy_text");
    expect(line.msg).toBe("free text 1");
    expect(line.run_id).toBe(R);
  });

  test("the old form in text stays unchanged, with no context", () => {
    setLogFormat("text");
    withLogContext({ run_id: R }, () => log.info("free text 1"));
    expect(out.mock.calls[0]).toEqual(["[mail]", "free text 1"]);
  });

  test("the text event form shows the context keys", () => {
    setLogFormat("text");
    withLogContext({ job: "mail.sync", run_id: R }, () => log.info("sync_done", { count: 1 }));
    expect(out.mock.calls[0]).toEqual(["[mail]", `sync_done job=mail.sync run_id=${R} count=1`]);
  });

  test("a bad context value is dropped and counted", () => {
    withLogContext({ job: "bad job" }, () => log.info("a"));
    const line = jsonLine(out);
    expect(line).not.toHaveProperty("job");
    expect(line.dropped_fields).toBe(1);
  });

  test("withLogContext returns the result of fn", async () => {
    expect(withLogContext({ run_id: R }, () => 7)).toBe(7);
    expect(await withLogContext({ run_id: R }, async () => 8)).toBe(8);
  });
});
