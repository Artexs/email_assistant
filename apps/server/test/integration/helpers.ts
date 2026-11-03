import type { Transaction } from "kysely";

import { createDb, type Db, type DB } from "../../src/platform/db";

export function testDb(): Db {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is missing: the integration tests need the app role URL");
  }
  return createDb(url);
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
