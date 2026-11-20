import { profileBodySchema, REPLY_SAMPLE_COUNT, styleSuggestionBodySchema, type ProfileInput } from "@ea/core";
import type { Context } from "hono";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { z } from "zod";

import type { Db } from "../../platform/db";
import { parseBody, requireOwner, ValidationError, type ApiEnv } from "../../platform/http";
import { getOrgOwner, isFeatureOn } from "../tenancy";

import { replyDocs } from "./api-docs";
import type { StylePreview } from "./preview";
import { getProfileView, updateMailboxProfile } from "./profile";
import { listSamples, sampleReplies, type ReplySampleScope } from "./samples";
import type { StyleSuggest } from "./style-suggest";

export interface ReplyRouteDeps {
  db: Db;
  // null: no model client runs (the LLM scope is off): a preview answers `failed` / `llm_off`.
  preview: StylePreview | null;
  // The clock and the model scope of the sample drafts. null: no model client runs, so a sample run answers 409 `llm_off`.
  samples?: ReplySampleScope | null;
  // The writing-style suggestion from the sent mail. Absent or null: no model client runs, so a suggestion answers `failed` / `llm_off`.
  styleSuggestion?: StyleSuggest | null;
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

  // The flags run before the role: every role gets 404 while one of them is off, also for a bad id (the rule of the new routes).
  const flagsFirst = (...flags: ("reply_drafts" | "style_from_sent")[]): MiddlewareHandler<ApiEnv> => {
    return async (c, next) => {
      for (const flag of flags) {
        if (!(await isFeatureOn(deps.db, c.get("ctx"), flag))) return notFound(c);
      }
      await next();
    };
  };
  const flagFirst = flagsFirst("reply_drafts");

  // One suggested writing style from the sent mail (owner only; hidden while either flag is off). The text goes to the owner to edit:
  // the server stores none of it. The answers of the service map one to one to the codes of the API doc.
  app.post(
    "/mailboxes/:id/profile/style-suggestion",
    flagsFirst("reply_drafts", "style_from_sent"),
    requireOwner,
    replyDocs.suggestStyle,
    async (c) => {
      const id = mailboxIdOf(c);
      if (!id) return notFound(c);
      await parseBody(c, styleSuggestionBodySchema);
      if (deps.styleSuggestion === undefined || deps.styleSuggestion === null) {
        return c.json({ kind: "failed" as const, reason: "llm_off" });
      }
      const owner = await getOrgOwner(deps.db, c.get("ctx"));
      const result = await deps.styleSuggestion(c.get("ctx"), id, {
        userId: c.get("session").userId,
        language: owner?.locale ?? null,
      });
      switch (result.kind) {
        case "suggestion":
          return c.json({ text: result.text, count: result.count });
        case "failed":
          return c.json({ kind: "failed" as const, reason: result.reason });
        case "sent_off":
          return c.json({ error: "sent_off" as const }, 409);
        case "too_few":
          return c.json({ error: "too_few" as const, count: result.count }, 409);
        case "blocked":
          return c.json({ error: "blocked" as const, reason: result.reason }, 409);
        case "limit":
          return c.json({ error: "suggest_limit" }, 429);
        case "busy":
          return c.json({ error: "suggest_busy" }, 429);
        case "not_found":
          return notFound(c);
      }
    }
  );

  // Sample drafts on recent real mail (owner only; hidden while the flag is off). The POST queues up to three `sample` requests; the
  // GET reads the run of today for the panel to poll. The texts are for the owner's eyes: nothing is saved in Drafts or sent.
  app.post("/mailboxes/:id/reply-samples", flagFirst, requireOwner, replyDocs.postSamples, async (c) => {
    const id = mailboxIdOf(c);
    if (!id) return notFound(c);
    if (deps.samples === undefined || deps.samples === null) return c.json({ error: "llm_off" }, 409);
    const result = await sampleReplies({ db: deps.db, ...deps.samples }, c.get("ctx"), {
      mailboxId: id,
      userId: c.get("session").userId,
      via: "web",
      count: REPLY_SAMPLE_COUNT,
    });
    switch (result.kind) {
      case "queued":
        return c.json({ requestIds: result.requestIds, count: result.count }, 202);
      case "blocked":
        return c.json({ error: "blocked" as const, reason: result.reason }, 409);
      case "sample_limit":
        return c.json({ error: "sample_limit" as const }, 409);
      case "forbidden":
        return c.json({ error: "owner_only" }, 403);
      case "feature_off":
      case "not_found":
        return notFound(c);
    }
  });

  app.get("/mailboxes/:id/reply-samples", flagFirst, requireOwner, replyDocs.getSamples, async (c) => {
    const id = mailboxIdOf(c);
    if (!id) return notFound(c);
    const items = await listSamples({ db: deps.db, now: deps.samples?.now ?? (() => new Date()) }, c.get("ctx"), id);
    return items === null ? notFound(c) : c.json({ items });
  });

  return app;
}
