import { randomBytes } from "node:crypto";

import type { Transaction } from "kysely";

import { createSecretBox } from "../../src/platform/crypto";
import type { DB } from "../../src/platform/db";

import { NOW, type Clock, type JobBox } from "./reply-job-fixtures";

export const secrets = createSecretBox(randomBytes(32).toString("base64"), 1);
export const fresh = (): Clock => ({ now: NOW });

// The open reply sends of an organization: waiting for a tap, tapped, or going out.
export async function openReplySends(trx: Transaction<DB>, box: JobBox) {
  return trx
    .selectFrom("actions")
    .selectAll()
    .where("org_id", "=", box.ctx.orgId)
    .where("type", "=", "send")
    .where("status", "in", ["awaiting_approval", "approved", "applying"])
    .execute();
}
