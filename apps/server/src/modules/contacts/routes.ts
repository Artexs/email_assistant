import { suggestionActionBodySchema, z, type SuggestionList } from "@ea/core";
import { Hono, type Context, type MiddlewareHandler } from "hono";

import type { Db } from "../../platform/db";
import { parseBody, requireOwner, type ApiEnv } from "../../platform/http";
import { getMailbox, type TestMailRule } from "../mail";

import { suggestionDocs } from "./api-docs";
import { senderFlags } from "./flags";
import {
  acceptSuggestion,
  dismissSuggestion,
  listOpenSuggestions,
  type AcceptResult,
  type DismissResult,
} from "./suggestion-commands";

export interface SuggestionRouteDeps {
  db: Db;
  now(): Date;
  testMail: TestMailRule;
}

/**
 * The suggestion routes (flags `sender_suggestions` and `sender_context`). The flag check comes first: with either flag off
 * every route is a 404 `not_found` for every role, also with a bad id or body. Any member lists; only an owner accepts or
 * dismisses (403 `owner_only` before any row is read). Accept goes through `addSenderRule`, the writer of the Rules page. A
 * mailbox or a suggestion of another organization, an unknown id and a bad id are the same 404. No answer, audit row or log
 * line of these routes names an address except the list itself, which is the product data of the member.
 */
export function suggestionRoutes(deps: SuggestionRouteDeps): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  const notFound = (c: Context<ApiEnv>) => c.json({ error: "not_found" }, 404);

  const flagFirst: MiddlewareHandler<ApiEnv> = async (c, next) => {
    if (!(await senderFlags(deps.db, c.get("ctx"))).suggestions) return notFound(c);
    await next();
  };

  app.get("/suggestions/:mailboxId", flagFirst, suggestionDocs.getSuggestions, async (c) => {
    const mailboxId = z.uuid().safeParse(c.req.param("mailboxId"));
    if (!mailboxId.success) return notFound(c);
    const ctx = c.get("ctx");
    if ((await getMailbox(deps.db, ctx, mailboxId.data)) === undefined) return notFound(c);
    const items = await listOpenSuggestions(deps.db, ctx, mailboxId.data);
    const body: SuggestionList = items.map((item) => ({ ...item, createdAt: item.createdAt.toISOString() }));
    return c.json(body);
  });

  app.post("/suggestions/:id/accept", flagFirst, requireOwner, suggestionDocs.postSuggestionAccept, async (c) => {
    const id = z.uuid().safeParse(c.req.param("id"));
    if (!id.success) return notFound(c);
    await parseBody(c, suggestionActionBodySchema);
    const result: AcceptResult = await acceptSuggestion(deps, c.get("ctx"), {
      id: id.data,
      actor: c.get("session").userId,
      via: "web",
    });
    switch (result) {
      case "accepted":
        return c.json({ status: "accepted" });
      case "already":
        return c.json({ error: "already" }, 409);
      case "rule_limit":
        return c.json({ error: "rule_limit" }, 409);
      case "not_available":
        return c.json({ error: "not_available" }, 409);
      case "not_found":
        return notFound(c);
    }
  });

  app.post("/suggestions/:id/dismiss", flagFirst, requireOwner, suggestionDocs.postSuggestionDismiss, async (c) => {
    const id = z.uuid().safeParse(c.req.param("id"));
    if (!id.success) return notFound(c);
    await parseBody(c, suggestionActionBodySchema);
    const result: DismissResult = await dismissSuggestion(deps, c.get("ctx"), {
      id: id.data,
      actor: c.get("session").userId,
      via: "web",
    });
    switch (result) {
      case "dismissed":
        return c.json({ status: "dismissed" });
      case "already":
        return c.json({ error: "already" }, 409);
      case "not_found":
        return notFound(c);
    }
  });

  return app;
}
