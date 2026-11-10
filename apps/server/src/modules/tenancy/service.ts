import type { Transaction } from "kysely";
import { z } from "zod";

import type { DB, Db } from "../../platform/db";

import { insertMembership, insertOrganization, insertUser } from "./repo";

const createOrganizationInputSchema = z.object({
  orgName: z.string().trim().min(1),
  timezone: z.string().refine((tz) => Intl.supportedValuesOf("timeZone").includes(tz), "invalid timezone"),
  email: z.email().transform((email) => email.toLowerCase()),
  displayName: z.string().trim().min(1),
});

export type CreateOrganizationInput = z.input<typeof createOrganizationInputSchema>;

// Runs in the caller's transaction when it gets one, else opens its own.
export async function createOrganizationWithOwner(
  db: Db | Transaction<DB>,
  input: CreateOrganizationInput
): Promise<{ orgId: string; userId: string }> {
  const valid = createOrganizationInputSchema.parse(input);

  const run = async (trx: Db | Transaction<DB>) => {
    const org = await insertOrganization(trx, { name: valid.orgName, timezone: valid.timezone });
    const user = await insertUser(trx, { email: valid.email, displayName: valid.displayName });
    await insertMembership(trx, { orgId: org.id }, { userId: user.id, role: "owner" });
    return { orgId: org.id, userId: user.id };
  };

  return db.isTransaction ? run(db) : db.transaction().execute(run);
}
