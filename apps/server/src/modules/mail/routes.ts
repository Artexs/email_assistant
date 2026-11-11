import { removeMailboxBodySchema, z, type ScopeEnv } from "@ea/core";
import { Hono, type Context } from "hono";

import type { Db } from "../../platform/db";
import { parseBody, requireOwner, type ApiEnv } from "../../platform/http";

import type { ConnectDeps } from "./connect";
import { removeMailbox, type RemoveDeps } from "./remove";
import { switchMailboxStatus } from "./status";
import { getMailboxView, listMailboxViews } from "./views";

// B5: the socket timeout of each login and the deadline of the whole check, inside one web request.
export const WEB_MAIL_TIMEOUTS = { socketMs: 20_000, deadlineMs: 25_000 } as const;

export interface MailRouteDeps {
  db: Db;
  now(): Date;
  scopeEnv: ScopeEnv;
  connect: ConnectDeps; // with timeouts: WEB_MAIL_TIMEOUTS (the connect route of stage 8 uses it)
  allowLocalHosts: boolean; // the connect route of stage 8 uses it
  onRemoved: RemoveDeps["onRemoved"];
}

// A bad id is an unknown id: no database call.
function mailboxIdOf(c: Context): string | null {
  const parsed = z.uuid().safeParse(c.req.param("id"));
  return parsed.success ? parsed.data : null;
}

export function mailRoutes(deps: MailRouteDeps): Hono<ApiEnv> {
  const { db, scopeEnv } = deps;
  const app = new Hono<ApiEnv>();

  app.get("/mailboxes", async (c) => c.json(await listMailboxViews(db, c.get("ctx"), scopeEnv)));

  const switchRoute = (to: "paused" | "active") => async (c: Context<ApiEnv>) => {
    const id = mailboxIdOf(c);
    if (id === null) return c.json({ error: "not_found" }, 404);
    const ctx = c.get("ctx");
    const result = await switchMailboxStatus(db, ctx, id, {
      to,
      actor: c.get("session").userId,
      via: "web",
      now: deps.now(),
    });
    if (result.kind === "not_found") return c.json({ error: "not_found" }, 404);
    if (result.kind === "auth_error") return c.json({ error: "wrong_status" }, 409);
    const view = await getMailboxView(db, ctx, id, scopeEnv);
    return view ? c.json(view) : c.json({ error: "not_found" }, 404);
  };
  app.post("/mailboxes/:id/pause", requireOwner, switchRoute("paused"));
  app.post("/mailboxes/:id/resume", requireOwner, switchRoute("active"));

  app.delete("/mailboxes/:id", requireOwner, async (c) => {
    const id = mailboxIdOf(c);
    if (id === null) return c.json({ error: "not_found" }, 404);
    const { confirmAddress } = await parseBody(c, removeMailboxBodySchema);
    const result = await removeMailbox({ db, onRemoved: deps.onRemoved }, c.get("ctx"), id, {
      userId: c.get("session").userId,
      confirmAddress,
      now: deps.now(),
    });
    if (result.kind === "not_found") return c.json({ error: "not_found" }, 404);
    if (result.kind === "confirm_mismatch") return c.json({ error: "confirm_mismatch" }, 400);
    return c.body(null, 204);
  });

  return app;
}
