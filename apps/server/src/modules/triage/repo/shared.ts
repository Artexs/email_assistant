import type { Transaction } from "kysely";

import type { DB, Db } from "../../../platform/db";

export type DbOrTrx = Db | Transaction<DB>;
