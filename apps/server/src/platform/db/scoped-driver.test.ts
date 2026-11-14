import { describe, expect, test } from "bun:test";
import type { CompiledQuery, DatabaseConnection, Driver, QueryResult } from "kysely";

import { ScopedDriver, SET_SCOPE_SQL } from "./scoped-driver";

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";

interface Recorded {
  sql: string;
  parameters: readonly unknown[];
}

interface FakeConnection extends DatabaseConnection {
  queries: Recorded[];
  failNext: Error | null;
}

const fakeConnection = (): FakeConnection => {
  const connection: FakeConnection = {
    queries: [],
    failNext: null,
    executeQuery<R>(query: CompiledQuery): Promise<QueryResult<R>> {
      connection.queries.push({ sql: query.sql, parameters: query.parameters });
      if (connection.failNext) {
        const error = connection.failNext;
        connection.failNext = null;
        return Promise.reject(error);
      }
      return Promise.resolve({ rows: [] });
    },
    streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
      throw new Error("not used");
    },
  };
  return connection;
};

interface Call {
  method: string;
  args: unknown[];
}

const fakeInner = (
  connections: FakeConnection[],
  opts: { savepoints?: boolean; onAcquire?: () => void; releaseFails?: boolean } = {}
): { driver: Driver; calls: Call[] } => {
  const calls: Call[] = [];
  let next = 0;
  const record =
    (method: string) =>
    (...args: unknown[]): Promise<void> => {
      calls.push({ method, args });
      return Promise.resolve();
    };
  const driver: Driver = {
    init: record("init"),
    destroy: record("destroy"),
    acquireConnection: () => {
      opts.onAcquire?.();
      const connection = connections[next % connections.length];
      next += 1;
      if (!connection) throw new Error("no connection");
      return Promise.resolve(connection);
    },
    releaseConnection: (connection) => {
      calls.push({ method: "releaseConnection", args: [connection] });
      return opts.releaseFails ? Promise.reject(new Error("release failed")) : Promise.resolve();
    },
    beginTransaction: record("beginTransaction"),
    commitTransaction: record("commitTransaction"),
    rollbackTransaction: record("rollbackTransaction"),
    ...(opts.savepoints === false
      ? {}
      : {
          savepoint: record("savepoint"),
          rollbackToSavepoint: record("rollbackToSavepoint"),
          releaseSavepoint: record("releaseSavepoint"),
        }),
  };
  return { driver, calls };
};

const setup = (connections: FakeConnection[], opts: Parameters<typeof fakeInner>[1] = {}) => {
  const scope: { value: string | null } = { value: null };
  const inner = fakeInner(connections, opts);
  const driver = new ScopedDriver(inner.driver, () => scope.value);
  return { driver, scope, calls: inner.calls };
};

describe("ScopedDriver", () => {
  test("a fresh connection with no scope runs no query", async () => {
    const c = fakeConnection();
    const { driver } = setup([c]);
    await driver.acquireConnection();
    expect(c.queries).toEqual([]);
  });

  test("scope A runs one set_config query", async () => {
    const c = fakeConnection();
    const { driver, scope } = setup([c]);
    scope.value = A;
    await driver.acquireConnection();
    expect(c.queries).toEqual([{ sql: "select set_config('app.org_id', $1, false)", parameters: [A] }]);
    expect(SET_SCOPE_SQL).toBe("select set_config('app.org_id', $1, false)");
  });

  test("the same scope again runs no new query", async () => {
    const c = fakeConnection();
    const { driver, scope } = setup([c]);
    scope.value = A;
    await driver.acquireConnection();
    await driver.acquireConnection();
    await driver.acquireConnection();
    expect(c.queries).toHaveLength(1);
  });

  test("scope null after scope A resets to the empty string", async () => {
    const c = fakeConnection();
    const { driver, scope } = setup([c]);
    scope.value = A;
    await driver.acquireConnection();
    scope.value = null;
    await driver.acquireConnection();
    expect(c.queries).toHaveLength(2);
    expect(c.queries[1]?.parameters).toEqual([""]);
  });

  test("the memory is per connection", async () => {
    const c1 = fakeConnection();
    const c2 = fakeConnection();
    const { driver, scope } = setup([c1, c2]);
    scope.value = A;
    await driver.acquireConnection();
    await driver.acquireConnection();
    expect(c1.queries).toHaveLength(1);
    expect(c2.queries).toHaveLength(1);
  });

  test("a failed set query releases the connection, rejects, and marks the state unknown", async () => {
    const c = fakeConnection();
    const { driver, scope, calls } = setup([c]);
    scope.value = A;
    c.failNext = new Error("boom");
    await expect(driver.acquireConnection()).rejects.toThrow("boom");
    expect(calls.filter((call) => call.method === "releaseConnection")).toEqual([
      { method: "releaseConnection", args: [c] },
    ]);
    scope.value = null;
    await driver.acquireConnection();
    expect(c.queries.at(-1)?.parameters).toEqual([""]);
    expect(c.queries).toHaveLength(2);
  });

  test("a failing release does not hide the set_config error", async () => {
    const c = fakeConnection();
    const { driver, scope } = setup([c], { releaseFails: true });
    scope.value = A;
    c.failNext = new Error("boom");
    await expect(driver.acquireConnection()).rejects.toThrow("boom");
  });

  test("the scope is read before the inner acquire", async () => {
    const c = fakeConnection();
    const holder: { scope: { value: string | null } | null } = { scope: null };
    const { driver, scope } = setup([c], {
      onAcquire: () => {
        if (holder.scope) holder.scope.value = B;
      },
    });
    holder.scope = scope;
    scope.value = A;
    await driver.acquireConnection();
    expect(c.queries.map((q) => q.parameters)).toEqual([[A]]);
  });

  test("every other method forwards with the same arguments", async () => {
    const c = fakeConnection();
    const { driver, calls } = setup([c]);
    const compile = (): CompiledQuery => ({}) as CompiledQuery;
    const settings = { isolationLevel: "serializable" as const };
    await driver.init();
    await driver.beginTransaction(c, settings);
    await driver.commitTransaction(c);
    await driver.rollbackTransaction(c);
    await driver.savepoint?.(c, "sp", compile);
    await driver.rollbackToSavepoint?.(c, "sp", compile);
    await driver.releaseSavepoint?.(c, "sp", compile);
    await driver.releaseConnection(c);
    await driver.destroy();
    expect(calls).toEqual([
      { method: "init", args: [undefined] },
      { method: "beginTransaction", args: [c, settings] },
      { method: "commitTransaction", args: [c] },
      { method: "rollbackTransaction", args: [c] },
      { method: "savepoint", args: [c, "sp", compile] },
      { method: "rollbackToSavepoint", args: [c, "sp", compile] },
      { method: "releaseSavepoint", args: [c, "sp", compile] },
      { method: "releaseConnection", args: [c] },
      { method: "destroy", args: [undefined] },
    ]);
  });

  test("an inner driver without savepoints rejects the savepoint calls", async () => {
    const c = fakeConnection();
    const { driver } = setup([c], { savepoints: false });
    const compile = (): CompiledQuery => ({}) as CompiledQuery;
    await expect(driver.savepoint(c, "sp", compile)).rejects.toThrow(
      "savepoints are not supported by the inner driver"
    );
  });
});
