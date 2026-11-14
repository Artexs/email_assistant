import { actionTypes } from "@ea/core";
import type { Transaction } from "kysely";
import { z } from "zod";

import type { DB, Db } from "../../../platform/db";

export type DbOrTrx = Db | Transaction<DB>;
export const actionTypeSchema = z.enum(actionTypes);
