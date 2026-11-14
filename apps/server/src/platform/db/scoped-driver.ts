import {
  CompiledQuery,
  PostgresDialect,
  type AbortableOperationOptions,
  type DatabaseConnection,
  type Driver,
  type QueryCompiler,
  type TransactionSettings,
} from "kysely";

import { currentTenantScope } from "./tenant-scope";

// A write failed: the server value of the connection is not known (RLS safety net).
const UNKNOWN = Symbol("unknown");

/** The statement that sets the scope of a connection for the whole session, not one transaction (RLS safety net). */
export const SET_SCOPE_SQL = "select set_config('app.org_id', $1, false)";

type Compile = QueryCompiler["compileQuery"];

/** Wraps a driver: each acquire sets app.org_id to the scope of the call chain, only when it changes (RLS safety net, ADR 0011). */
export class ScopedDriver implements Driver {
  readonly #inner: Driver;
  readonly #scopeOf: () => string | null;
  readonly #state = new WeakMap<DatabaseConnection, string | typeof UNKNOWN>();

  constructor(inner: Driver, scopeOf: () => string | null) {
    this.#inner = inner;
    this.#scopeOf = scopeOf;
  }

  init(options?: AbortableOperationOptions): Promise<void> {
    return this.#inner.init(options);
  }

  async acquireConnection(options?: AbortableOperationOptions): Promise<DatabaseConnection> {
    const want = this.#scopeOf() ?? "";
    const connection = await this.#inner.acquireConnection(options);
    const have = this.#state.get(connection) ?? "";
    if (have !== want) {
      try {
        await connection.executeQuery(CompiledQuery.raw(SET_SCOPE_SQL, [want]));
        this.#state.set(connection, want);
      } catch (error) {
        this.#state.set(connection, UNKNOWN);
        try {
          await this.#inner.releaseConnection(connection);
        } catch {
          // The set_config error is the one that matters.
        }
        throw error;
      }
    }
    return connection;
  }

  beginTransaction(connection: DatabaseConnection, settings: TransactionSettings): Promise<void> {
    return this.#inner.beginTransaction(connection, settings);
  }

  commitTransaction(connection: DatabaseConnection): Promise<void> {
    return this.#inner.commitTransaction(connection);
  }

  rollbackTransaction(connection: DatabaseConnection): Promise<void> {
    return this.#inner.rollbackTransaction(connection);
  }

  async savepoint(connection: DatabaseConnection, name: string, compile: Compile): Promise<void> {
    await this.#savepointMethod("savepoint")(connection, name, compile);
  }

  async rollbackToSavepoint(connection: DatabaseConnection, name: string, compile: Compile): Promise<void> {
    await this.#savepointMethod("rollbackToSavepoint")(connection, name, compile);
  }

  async releaseSavepoint(connection: DatabaseConnection, name: string, compile: Compile): Promise<void> {
    await this.#savepointMethod("releaseSavepoint")(connection, name, compile);
  }

  releaseConnection(connection: DatabaseConnection, options?: AbortableOperationOptions): Promise<void> {
    return this.#inner.releaseConnection(connection, options);
  }

  destroy(options?: AbortableOperationOptions): Promise<void> {
    return this.#inner.destroy(options);
  }

  #savepointMethod(
    method: "savepoint" | "rollbackToSavepoint" | "releaseSavepoint"
  ): (connection: DatabaseConnection, name: string, compile: Compile) => Promise<void> {
    const forward = this.#inner[method];
    if (forward === undefined) {
      throw new Error("savepoints are not supported by the inner driver");
    }
    return forward.bind(this.#inner);
  }
}

/** The Postgres dialect with a ScopedDriver: the RLS safety net writes app.org_id on each acquire (ADR 0011). */
export class ScopedPostgresDialect extends PostgresDialect {
  override createDriver(): Driver {
    return new ScopedDriver(super.createDriver(), currentTenantScope);
  }
}
