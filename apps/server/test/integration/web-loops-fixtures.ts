import { randomUUID } from "node:crypto";

import { configureFeatures, isOrgSuspended, setOrgFeature } from "../../src/modules/tenancy";
import type { Db } from "../../src/platform/db";

import { insertDelegate, insertTriaged } from "./fixtures";
import { commandOrg, FRIDAY, type CommandOrg } from "./loops-commands-fixtures";
import { as, webTestApp } from "./web-helpers";

// Committed rows for the route tests of the open loops (F116 stage 20): the routes read through their own connections, so a
// rolled-back transaction would show them nothing. Two organizations, each with the flag `open_loops`, an `assist` mailbox
// with drafts on and the Sent tracking on. Organization A also has the flag `delegate_button`, an active delegate and a triaged mail.
export { FRIDAY };

export interface LoopWorld {
  a: CommandOrg;
  b: CommandOrg;
  delegateId: string;
  emailId: string;
  sessions: Record<string, string>;
  cleanup(): Promise<void>;
}

export async function loopWorld(db: Db): Promise<LoopWorld> {
  await configureFeatures({ off: [] });
  const made = await db.transaction().execute(async (trx) => {
    const a = await commandOrg(trx);
    const b = await commandOrg(trx);
    await setOrgFeature(trx, a.ctx, { flag: "delegate_button", enabled: true, actor: "cli", now: FRIDAY });
    const delegateId = await insertDelegate(trx, a.ctx, { name: "Anna", email: `delegate-${randomUUID()}@x.test` });
    const emailId = await insertTriaged(trx, a.ctx, a.mailboxId, {
      category: "info",
      createdAt: FRIDAY,
      subject: "Offer for the autumn campaign",
      from: `sender-${randomUUID()}@y.test`,
      fields: { language: "en" },
    });
    return { a, b, delegateId, emailId };
  });
  const users = [made.a.userId, made.a.memberId, made.b.userId, made.b.memberId];
  return {
    ...made,
    // owner and member of A; the owner of B
    sessions: { owner: made.a.userId, member: made.a.memberId, other: made.b.userId },
    async cleanup() {
      for (const orgId of [made.a.ctx.orgId, made.b.ctx.orgId]) {
        await db.deleteFrom("organizations").where("id", "=", orgId).execute();
      }
      await db.deleteFrom("users").where("id", "in", users).execute();
    },
  };
}

// The app with the routes of one test; `now` is Friday 2026-11-20 09:00 in Warsaw.
export function loopApp(db: Db, world: LoopWorld, routers: Parameters<typeof webTestApp>[0]["routers"]) {
  return webTestApp({
    db,
    sessions: world.sessions,
    isOrgSuspended: (orgId) => isOrgSuspended(db, { orgId }),
    routers,
  });
}

export async function call(
  app: ReturnType<typeof loopApp>,
  who: string,
  method: "GET" | "POST" | "PATCH",
  path: string,
  body?: unknown
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await app.request(`/api${path}`, as(who, { method, ...(body === undefined ? {} : { body }) }));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}
