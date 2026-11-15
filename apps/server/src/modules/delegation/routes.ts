import {
  delegateAddBodySchema,
  delegatePatchBodySchema,
  delegateSchema,
  DELEGATE_LIST_MAX,
  z,
  type Delegate,
  type DelegateList,
} from "@ea/core";
import { Hono, type MiddlewareHandler } from "hono";

import type { Db } from "../../platform/db";
import { parseBody, requireOwner, ValidationError, type ApiEnv } from "../../platform/http";
import { isFeatureOn } from "../tenancy";

import { delegateDocs } from "./api-docs";
import { getDelegate, listDelegates, type DelegateRow } from "./repo";
import { addDelegate, updateDelegate } from "./service";

export interface DelegateRouteDeps {
  db: Db;
  now(): Date;
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
