import { profileBodySchema, type ProfileInput } from "@ea/core";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";

import type { Db } from "../../platform/db";
import { parseBody, requireOwner, ValidationError, type ApiEnv } from "../../platform/http";
import { isFeatureOn } from "../tenancy";

import { replyDocs } from "./api-docs";
import type { StylePreview } from "./preview";
import { getProfileView, updateMailboxProfile } from "./profile";

export interface ReplyRouteDeps {
  db: Db;
  // null: no model client runs (the LLM scope is off): a preview answers `failed` / `llm_off`.
  preview: StylePreview | null;
}

type Ctx = Context<ApiEnv>;

// null: not a UUID. The route answers 404 with no database call.
function mailboxIdOf(c: Ctx): string | null {
  const parsed = z.uuid().safeParse(c.req.param("id"));
  return parsed.success ? parsed.data : null;
}

// Only the keys that the body holds: `exactOptionalPropertyTypes` keeps a missing key apart from `undefined`.
function inputOf(body: z.infer<typeof profileBodySchema>): ProfileInput {
  return {
    ...(body.displayName === undefined ? {} : { displayName: body.displayName }),
    ...(body.signature === undefined ? {} : { signature: body.signature }),
    ...(body.writingStyle === undefined ? {} : { writingStyle: body.writingStyle }),
  };
}

// The error names the field and a code, never the text.
function invalid(field: string, code: string): ValidationError {
  return new ValidationError([{ path: field, code: "custom", message: code }]);
}

export function replyRoutes(deps: ReplyRouteDeps): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  const notFound = (c: Ctx) => c.json({ error: "not_found" }, 404);

  // The profile is read for every kind of draft, so it has no flag. A mailbox of another organization answers 404.
  app.get("/mailboxes/:id/profile", replyDocs.getProfile, async (c) => {
    const id = mailboxIdOf(c);
    if (!id) return notFound(c);
    const view = await getProfileView(deps.db, c.get("ctx"), id);
    return view === undefined ? notFound(c) : c.json(view);
  });

  // The owner check comes before the lookup: a member gets 403 whether the id exists or not.
  app.put("/mailboxes/:id/profile", requireOwner, replyDocs.putProfile, async (c) => {
    const id = mailboxIdOf(c);
    if (!id) return notFound(c);
    const body = await parseBody(c, profileBodySchema);
    const result = await updateMailboxProfile(deps.db, c.get("ctx"), id, inputOf(body), {
      via: "web",
      userId: c.get("session").userId,
    });
    if (result.kind === "not_found") return notFound(c);
    if (result.kind === "invalid") throw invalid(result.field, result.code);
    return c.json(result.view);
  });

  // The preview belongs to the reply feature: it is hidden (404) while the flag `reply_drafts` is off.
  app.post("/mailboxes/:id/profile/preview", requireOwner, replyDocs.previewProfile, async (c) => {
    const id = mailboxIdOf(c);
    if (!id || !(await isFeatureOn(deps.db, c.get("ctx"), "reply_drafts"))) return notFound(c);
    const body = await parseBody(c, profileBodySchema);
    if (deps.preview === null) return c.json({ kind: "failed" as const, reason: "llm_off" });
    const result = await deps.preview(c.get("ctx"), id, inputOf(body));
    switch (result.kind) {
      case "draft":
        return c.json({ body: result.body });
      case "failed":
        return c.json({ kind: "failed" as const, reason: result.reason });
      case "invalid":
        throw invalid(result.field, result.code);
      case "limit":
        return c.json({ error: "preview_limit" }, 429);
      case "busy":
        return c.json({ error: "preview_busy" }, 429);
      case "not_found":
        return notFound(c);
    }
  });

  return app;
}
