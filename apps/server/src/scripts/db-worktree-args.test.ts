import { describe, expect, test } from "bun:test";

import {
  adminUrl,
  hasWorktreeMark,
  isLoopbackHost,
  parseDbWorktreeArgs,
  sameServer,
  withDatabase,
  worktreeDatabaseName,
} from "./db-worktree-args";

const devUrl = "postgres://app:pw@127.0.0.1:5433/email_assistant?sslmode=disable";

describe("parseDbWorktreeArgs", () => {
  test("parses a name and the drop flag", () => {
    expect(parseDbWorktreeArgs(["abc"])).toEqual({ name: "abc", drop: false });
    expect(parseDbWorktreeArgs(["abc", "--drop"])).toEqual({ name: "abc", drop: true });
  });

  test("rejects a bad argument list", () => {
    expect(parseDbWorktreeArgs([])).toBeNull();
    expect(parseDbWorktreeArgs(["a", "b"])).toBeNull();
    expect(parseDbWorktreeArgs(["abc", "--force"])).toBeNull();
    expect(parseDbWorktreeArgs(["--drop"])).toBeNull();
  });
});

describe("worktreeDatabaseName", () => {
  test("builds the database name", () => {
    expect(worktreeDatabaseName("fake-telegram-followups")).toBe("email_assistant_fake_telegram_followups");
    expect(worktreeDatabaseName("s4_x1")).toBe("email_assistant_s4_x1");
  });

  test("refuses an unsafe name", () => {
    for (const name of ["", "-a", "_a", "Abc", "a b", "a;drop", 'a"b', "a.b"]) {
      expect(worktreeDatabaseName(name)).toBeNull();
    }
  });

  test("keeps the Postgres limit of 63 bytes", () => {
    const prefixLength = "email_assistant_".length;
    expect(worktreeDatabaseName("a".repeat(63 - prefixLength))?.length).toBe(63);
    expect(worktreeDatabaseName("a".repeat(64 - prefixLength))).toBeNull();
  });
});

describe("urls", () => {
  test("withDatabase changes only the database", () => {
    expect(withDatabase(devUrl, "email_assistant_x")).toBe(
      "postgres://app:pw@127.0.0.1:5433/email_assistant_x?sslmode=disable"
    );
  });

  test("adminUrl uses postgres and keeps special characters of the password", () => {
    const parsed = new URL(adminUrl(devUrl, "p@ss/w%41#"));
    expect(parsed.username).toBe("postgres");
    expect(decodeURIComponent(parsed.password)).toBe("p@ss/w%41#");
    expect(parsed.pathname).toBe("/postgres");
    expect(parsed.host).toBe("127.0.0.1:5433");
    expect(parsed.search).toBe("?sslmode=disable");
  });

  test("isLoopbackHost", () => {
    for (const host of ["127.0.0.1", "localhost", "[::1]"]) {
      expect(isLoopbackHost(`postgres://u:p@${host}:5433/d`)).toBe(true);
    }
    for (const host of ["db", "10.0.0.5", "example.com"]) {
      expect(isLoopbackHost(`postgres://u:p@${host}:5433/d`)).toBe(false);
    }
  });

  test("sameServer compares host and port", () => {
    expect(sameServer("postgres://a:b@127.0.0.1:5433/x", "postgres://c:d@127.0.0.1:5433/y")).toBe(true);
    expect(sameServer("postgres://a:b@127.0.0.1:5433/x", "postgres://a:b@127.0.0.1:5432/x")).toBe(false);
    expect(sameServer("postgres://a:b@127.0.0.1:5433/x", "postgres://a:b@localhost:5433/x")).toBe(false);
  });
});

describe("hasWorktreeMark", () => {
  test("accepts only the exact mark", () => {
    expect(hasWorktreeMark("db:worktree")).toBe(true);
    for (const comment of [null, "", "other", "db:worktree "]) {
      expect(hasWorktreeMark(comment)).toBe(false);
    }
  });
});
