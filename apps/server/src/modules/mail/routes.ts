import {
  connectMailboxBodySchema,
  mailboxPasswordBodySchema,
  removeMailboxBodySchema,
  z,
  type ApiErrorCode,
  type ScopeEnv,
} from "@ea/core";
import { Hono, type Context } from "hono";

import type { Db } from "../../platform/db";
import { HardError, SoftError, describeError } from "../../platform/errors";
import { parseBody, requireOwner, type ApiEnv } from "../../platform/http";
import { createLog } from "../../platform/log";

import { updateMailboxPassword, type ConnectDeps } from "./connect";
import { connectMailboxRequest } from "./connect-request";
import { HostNotAllowedError, MailAuthError, MailboxExistsError, MailboxNotFoundError } from "./port";
import { removeMailbox, type RemoveDeps } from "./remove";
import { switchMailboxStatus } from "./status";
import { getMailboxView, listMailboxViews } from "./views";

const log = createLog("mail");

// B5: the socket timeout of each login and the deadline of the whole check, inside one web request.
export const WEB_MAIL_TIMEOUTS = { socketMs: 20_000, deadlineMs: 25_000 } as const;

export interface MailRouteDeps {
  db: Db;
  now(): Date;
  scopeEnv: ScopeEnv;
  connect: ConnectDeps; // with timeouts: WEB_MAIL_TIMEOUTS
  allowLocalHosts: boolean;
  onRemoved: RemoveDeps["onRemoved"];
}

// B11: the status and code of a connect or password failure; null for an unknown error (the route rethrows: 500).
// The order matters: the first four are HardErrors. The body never holds the error message (it may name a host).
export function mailErrorBody(error: unknown): { status: 400 | 404 | 409 | 422 | 502; error: ApiErrorCode } | null {
  if (error instanceof HostNotAllowedError) return { status: 400, error: "host_not_allowed" };
  if (error instanceof MailboxNotFoundError) return { status: 404, error: "not_found" };
  if (error instanceof MailboxExistsError) return { status: 409, error: "mailbox_exists" };
  if (error instanceof MailAuthError) return { status: 422, error: "mail_login_failed" };
  if (error instanceof SoftError || error instanceof HardError) return { status: 502, error: "mail_unreachable" };
  return null;
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
  app.post("/mailboxes", requireOwner, async (c) => {
    const body = await parseBody(c, connectMailboxBodySchema);
    try {
      const { mailboxId, info } = await connectMailboxRequest(
        { ...deps.connect, allowLocalHosts: deps.allowLocalHosts },
        c.get("ctx"),
        { body, actor: c.get("session").userId }
      );
      const { move, uidplus, idle } = info.capabilities;
      return c.json(
        { id: mailboxId, address: body.address, status: "active", capabilities: { move, uidplus, idle } },
        201
      );
    } catch (error) {
      const mapped = mailErrorBody(error);
      if (!mapped) throw error;
      if (mapped.status >= 422) log.info(`web: mailbox connect failed: ${describeError(error)}`);
      return c.json({ error: mapped.error }, mapped.status);
    }
  });

  app.post("/mailboxes/:id/password", requireOwner, async (c) => {
    const id = mailboxIdOf(c);
    if (id === null) return c.json({ error: "not_found" }, 404);
    const { password, secretKind } = await parseBody(c, mailboxPasswordBodySchema);
    const ctx = c.get("ctx");
    try {
      await updateMailboxPassword(deps.connect, ctx, {
        mailboxId: id,
        password,
        secretKind,
        now: deps.now(),
        actor: c.get("session").userId,
      });
    } catch (error) {
      const mapped = mailErrorBody(error);
      if (!mapped) throw error;
      if (mapped.status >= 422) log.info(`web: mailbox password check failed: ${describeError(error)}`);
      return c.json({ error: mapped.error }, mapped.status);
    }
    const view = await getMailboxView(db, ctx, id, scopeEnv);
    return view ? c.json(view) : c.json({ error: "not_found" }, 404);
  });

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
