import { Kysely, type Transaction } from "kysely";
import { Pool } from "pg";

import { type Db, type DB, ScopedPostgresDialect } from "../../src/platform/db";

/**
 * A test pool gives back an idle connection after 500 ms (the production pool keeps it 10 s). `bun test --parallel=4` runs 4 files at once,
 * and race files open several pools of 8 to 10 connections that stay idle for the rest of the file: one run of the job DB reached 19 to 32
 * connections, nearly all idle. The same limits as `createDb` otherwise: `max` 10, 5 s to connect.
 */
const TEST_POOL_IDLE_MS = 500;

export function testDb(): Db {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is missing: the integration tests need the app role URL");
  }
  return new Kysely<DB>({
    dialect: new ScopedPostgresDialect({
      pool: new Pool({
        connectionString: url,
        max: 10,
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: TEST_POOL_IDLE_MS,
      }),
    }),
  });
}

export class Rollback extends Error {
  constructor() {
    super("rollback");
    this.name = "Rollback";
  }
}

export async function withRollback(db: Db, fn: (trx: Transaction<DB>) => Promise<void>): Promise<void> {
  try {
    await db.transaction().execute(async (trx) => {
      await fn(trx);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) {
      throw error;
    }
  }
}

// A credentials key for the tests that hash a sender address (`senderKeyHash`) or run the data-request match: base64 of 32 bytes.
export const TEST_CREDENTIALS_KEY = Buffer.alloc(32, 7).toString("base64");
