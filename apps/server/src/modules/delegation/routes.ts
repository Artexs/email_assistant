import {
  delegateAddBodySchema,
  delegatePatchBodySchema,
  delegateSchema,
  delegationActionBodySchema,
  delegationListQuerySchema,
  DELEGATE_LIST_MAX,
  z,
  type Delegate,
  type DelegateList,
  type DelegationCancelAnswer,
  type DelegationDoneAnswer,
} from "@ea/core";
import { Hono, type MiddlewareHandler } from "hono";

import type { Db, TenantContext } from "../../platform/db";
import { parseBody, parseQuery, requireOwner, ValidationError, type ApiEnv } from "../../platform/http";
import type { ApprovalHooks, DelegationHooks } from "../actions";
import { isFeatureOn } from "../tenancy";

import { delegateDocs, delegationDocs } from "./api-docs";
import { decodeDelegationCursor, listDelegationItems } from "./list";
import { getDelegate, listDelegates, type DelegateRow } from "./repo";
import { addDelegate, cancelByUser, closeDelegation, delegationHooks, updateDelegate } from "./service";

export interface DelegateRouteDeps {
  db: Db;
  now(): Date;
}

export interface DelegationRouteDeps extends DelegateRouteDeps {
  // What a decision does for the cards of other channels: the real hook is built in `channels` (a layer above this module), so
  // the composition root passes it in. The Telegram cards follow a cancel from the panel.
  approvalHooks: ApprovalHooks;
  uidplus(ctx: TenantContext, mailboxId: string): Promise<boolean>;
  // Test seam: the delegation hooks (default: `delegationHooks`).
  hooks?: DelegationHooks;
}

const idSchema = z.uuid();

function idOf(raw: string): string {
  const parsed = idSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError([{ path: "id", code: "invalid_format", message: "invalid id" }]);
  return parsed.data;
}

function toDelegate(row: DelegateRow): Delegate {
  return delegateSchema.parse({
    id: row.id,
    name: row.name,
    email: row.email,
    tags: row.competence_tags,
    active: row.active,
    createdAt: row.created_at.toISOString(),
  });
}

// The code of a field that the service refused: the same body as a schema failure, with the field in `path`.
function invalidField(field: "name" | "email" | "tags"): ValidationError {
  return new ValidationError([{ path: field, code: "invalid_value", message: `invalid ${field}` }]);
}

// F102 ticket, P4 and P6: the routes of the delegates page. Any member reads; `POST` and `PATCH` are owner only. The flag comes
// first: with it off every route is a 404, also for a member and also with a bad id. Every write passes `via: "web"` and the user as actor.
export function delegateRoutes(deps: DelegateRouteDeps): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();

  const flagFirst: MiddlewareHandler<ApiEnv> = async (c, next) => {
    if (!(await isFeatureOn(deps.db, c.get("ctx"), "delegation_pages"))) return c.json({ error: "not_found" }, 404);
    await next();
  };

  app.get("/delegates", flagFirst, delegateDocs.listDelegates, async (c) => {
    const rows = await listDelegates(deps.db, c.get("ctx"), { activeFirst: true, limit: DELEGATE_LIST_MAX });
    return c.json<DelegateList>({ items: rows.map(toDelegate) });
  });

  app.post("/delegates", flagFirst, requireOwner, delegateDocs.addDelegate, async (c) => {
    const ctx = c.get("ctx");
    const body = await parseBody(c, delegateAddBodySchema);
    const result = await addDelegate(deps.db, ctx, {
      ...body,
      actor: c.get("session").userId,
      via: "web",
      now: deps.now(),
    });
    switch (result.kind) {
      case "added": {
        const row = await getDelegate(deps.db, ctx, result.id);
        if (row === undefined) return c.json({ error: "internal" }, 500);
        return c.json<Delegate>(toDelegate(row), 201);
      }
      case "exists":
        return c.json({ error: "exists" }, 409);
      case "mailbox_address":
        return c.json({ error: "mailbox_address" }, 400);
      case "invalid":
        throw invalidField(result.field);
    }
  });

  app.patch("/delegates/:id", flagFirst, requireOwner, delegateDocs.updateDelegate, async (c) => {
    const ctx = c.get("ctx");
    const id = idOf(c.req.param("id"));
    const body = await parseBody(c, delegatePatchBodySchema);
    const result = await updateDelegate(deps.db, ctx, {
      id,
      ...body,
      actor: c.get("session").userId,
      via: "web",
      now: deps.now(),
    });
    switch (result.kind) {
      case "not_found":
        return c.json({ error: "not_found" }, 404);
      case "invalid":
        throw invalidField(result.field);
      case "changed":
      case "same": {
        const row = await getDelegate(deps.db, ctx, id);
        if (row === undefined) return c.json({ error: "not_found" }, 404);
        return c.json<Delegate>(toDelegate(row));
      }
    }
  });

  return app;
}

// F102 stage 15: the routes of the delegations page. Any member reads and marks a delegation done; the cancel is owner
// only. The flag comes first, as for the delegates: with it off every route is a 404, for every role and with a bad id.
// Every write passes `via: "web"` and the user as actor.
export function delegationRoutes(deps: DelegationRouteDeps): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();

  const flagFirst: MiddlewareHandler<ApiEnv> = async (c, next) => {
    if (!(await isFeatureOn(deps.db, c.get("ctx"), "delegation_pages"))) return c.json({ error: "not_found" }, 404);
    await next();
  };

  app.get("/delegations", flagFirst, delegationDocs.listDelegations, async (c) => {
    const q = parseQuery(c, delegationListQuerySchema);
    const cursor = q.before === undefined ? undefined : decodeDelegationCursor(q.before);
    if (cursor === null) {
      throw new ValidationError([{ path: "before", code: "invalid_cursor", message: "invalid cursor" }]);
    }
    return c.json(
      await listDelegationItems(deps.db, c.get("ctx"), {
        ...(q.filter === undefined ? {} : { filter: q.filter }),
        ...(cursor === undefined ? {} : { cursor }),
        ...(q.limit === undefined ? {} : { limit: q.limit }),
      })
    );
  });

  app.post("/delegations/:id/done", flagFirst, delegationDocs.markDelegationDone, async (c) => {
    const ctx = c.get("ctx");
    const id = idOf(c.req.param("id"));
    await parseBody(c, delegationActionBodySchema);
    const result = await deps.db
      .transaction()
      .execute((trx) => closeDelegation(trx, ctx, id, { actor: c.get("session").userId, at: deps.now(), via: "web" }));
    switch (result.kind) {
      case "done":
        return c.json<DelegationDoneAnswer>({ status: "done" });
      case "already":
        return c.json({ error: "already" }, 409);
      case "not_closable":
        return c.json({ error: "not_closable" }, 409);
      case "not_found":
        return c.json({ error: "not_found" }, 404);
    }
  });

  app.post("/delegations/:id/cancel", flagFirst, requireOwner, delegationDocs.cancelDelegation, async (c) => {
    const ctx = c.get("ctx");
    const id = idOf(c.req.param("id"));
    await parseBody(c, delegationActionBodySchema);
    const result = await cancelByUser(
      {
        db: deps.db,
        hooks: deps.hooks ?? delegationHooks({ db: deps.db }),
        approvalHooks: deps.approvalHooks,
        uidplus: deps.uidplus,
      },
      ctx,
      id,
      { userId: c.get("session").userId, via: "web", now: deps.now() }
    );
    switch (result.kind) {
      case "cancelled":
        return c.json<DelegationCancelAnswer>({ status: "cancelled" });
      case "not_open":
        return c.json({ error: "not_open" }, 409);
      case "sending":
        return c.json({ error: "sending" }, 409);
      case "not_found":
        return c.json({ error: "not_found" }, 404);
    }
  });

  return app;
}
