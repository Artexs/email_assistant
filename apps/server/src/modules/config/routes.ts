import {
  autoBodySchema,
  barCategories,
  modeBodySchema,
  ruleBodySchema,
  rulesQuerySchema,
  switchableSyncFolderKeys,
  switchBodySchema,
  syncFolderBodySchema,
  toolSwitchNames,
  type BarCategory,
  type GateView,
  type RuleView,
  type SettingsWebChange,
  type SwitchableSyncFolderKey,
} from "@ea/core";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";

import type { Db, TenantContext } from "../../platform/db";
import { parseBody, parseQuery, requireOwner, type ApiEnv } from "../../platform/http";

import { getMailboxSettings, listSenderRuleRows, type SenderRuleRow } from "./repo";
import { addSenderRule, removeSenderRule } from "./rules";
import { setMode, setToolSwitch, SettingsNotFoundError, type SettingsChange } from "./service";
import { buildSettingsView, type SettingsViewDeps } from "./view";

export type AutoGateOutcome = { kind: "changed"; change: SettingsChange } | { kind: "refused"; gate: GateView };

export interface SettingsRouteDeps extends SettingsViewDeps {
  db: Db;
  now(): Date;
  setAuto(
    ctx: TenantContext,
    mailboxId: string,
    input: { category: BarCategory; auto: boolean; force: boolean; actor: string }
  ): Promise<AutoGateOutcome>;
  setSyncFolder(
    ctx: TenantContext,
    mailboxId: string,
    input: { key: SwitchableSyncFolderKey; enabled: boolean; actor: string; now: Date }
  ): Promise<"changed" | "same" | "not_found">;
}

type Ctx = Context<ApiEnv>;

// null: not a UUID. The route answers 404 with no database call.
function mailboxIdOf(c: Ctx): string | null {
  const parsed = z.uuid().safeParse(c.req.param("mailboxId"));
  return parsed.success ? parsed.data : null;
}

function member<T extends string>(list: readonly T[], value: string | undefined): T | null {
  return list.find((item) => item === value) ?? null;
}

export function settingsRoutes(deps: SettingsRouteDeps): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  const notFound = (c: Ctx) => c.json({ error: "not_found" }, 404);

  // A mailbox of another organization, or one without a settings row, is 404 before any gate query.
  const ensureSettings = async (c: Ctx, id: string): Promise<boolean> =>
    (await getMailboxSettings(deps.db, c.get("ctx"), id)) !== undefined;

  // A mailbox removed between the check and the write.
  const guarded = async (c: Ctx, run: () => Promise<Response>): Promise<Response> => {
    try {
      return await run();
    } catch (error) {
      if (error instanceof SettingsNotFoundError) return notFound(c);
      throw error;
    }
  };

  const respond = async (c: Ctx, id: string, change: { changed: boolean; expired: number }): Promise<Response> => {
    const body: SettingsWebChange = {
      changed: change.changed,
      expired: change.expired,
      settings: await buildSettingsView(deps, c.get("ctx"), id),
    };
    return c.json(body);
  };

  app.get("/settings/:mailboxId", async (c) => {
    const id = mailboxIdOf(c);
    if (!id || !(await ensureSettings(c, id))) return notFound(c);
    return guarded(c, async () => c.json(await buildSettingsView(deps, c.get("ctx"), id)));
  });

  app.patch("/settings/:mailboxId/mode", requireOwner, async (c) => {
    const id = mailboxIdOf(c);
    if (!id || !(await ensureSettings(c, id))) return notFound(c);
    const body = await parseBody(c, modeBodySchema);
    return guarded(c, async () => {
      const change = await setMode(deps.settings, c.get("ctx"), id, {
        mode: body.mode,
        keepSwitches: body.keepSwitches,
        actor: c.get("session").userId,
      });
      return respond(c, id, change);
    });
  });

  app.patch("/settings/:mailboxId/switches/:name", requireOwner, async (c) => {
    const id = mailboxIdOf(c);
    const name = member(toolSwitchNames, c.req.param("name"));
    if (!id || !name || !(await ensureSettings(c, id))) return notFound(c);
    const body = await parseBody(c, switchBodySchema);
    return guarded(c, async () => {
      const change = await setToolSwitch(deps.settings, c.get("ctx"), id, {
        name,
        value: body.value,
        actor: c.get("session").userId,
      });
      return respond(c, id, change);
    });
  });

  app.patch("/settings/:mailboxId/auto/:category", requireOwner, async (c) => {
    const id = mailboxIdOf(c);
    const category = member(barCategories, c.req.param("category"));
    if (!id || !category || !(await ensureSettings(c, id))) return notFound(c);
    const body = await parseBody(c, autoBodySchema);
    return guarded(c, async () => {
      const result = await deps.setAuto(c.get("ctx"), id, {
        category,
        auto: body.auto,
        force: body.force ?? false,
        actor: c.get("session").userId,
      });
      if (result.kind === "refused") return c.json({ error: "no_go", gate: result.gate }, 409);
      return respond(c, id, result.change);
    });
  });

  app.patch("/settings/:mailboxId/sync-folders/:key", requireOwner, async (c) => {
    const id = mailboxIdOf(c);
    const key = member(switchableSyncFolderKeys, c.req.param("key"));
    if (!id || !key || !(await ensureSettings(c, id))) return notFound(c);
    const body = await parseBody(c, syncFolderBodySchema);
    return guarded(c, async () => {
      const result = await deps.setSyncFolder(c.get("ctx"), id, {
        key,
        enabled: body.enabled,
        actor: c.get("session").userId,
        now: deps.now(),
      });
      if (result === "not_found") return notFound(c);
      return respond(c, id, { changed: result === "changed", expired: 0 });
    });
  });

  return app;
}

export interface RulesRouteDeps {
  db: Db;
  now(): Date;
}

function ruleView(row: SenderRuleRow): RuleView {
  return {
    id: row.id,
    kind: row.kind,
    pattern: row.pattern,
    mailboxId: row.mailbox_id,
    createdAt: row.created_at.toISOString(),
  };
}

export function rulesRoutes(deps: RulesRouteDeps): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();

  // A foreign or unknown mailboxId matches no mailbox rule: the answer holds the org-wide rules only.
  app.get("/rules", async (c) => {
    const query = parseQuery(c, rulesQuerySchema);
    const rows = await listSenderRuleRows(deps.db, c.get("ctx"), { mailboxId: query.mailboxId });
    return c.json(rows.map(ruleView));
  });

  app.post("/rules", requireOwner, async (c) => {
    const body = await parseBody(c, ruleBodySchema);
    const result = await addSenderRule(deps.db, c.get("ctx"), {
      mailboxId: body.mailboxId ?? null,
      pattern: body.pattern,
      kind: body.kind,
      actor: c.get("session").userId,
      now: deps.now(),
    });
    switch (result.kind) {
      case "added":
        return c.json(ruleView(result.rule), 201);
      case "exists":
        return c.json({ error: "rule_exists" }, 409);
      case "limit":
        return c.json({ error: "rule_limit" }, 409);
      case "mailbox_not_found":
        return c.json({ error: "not_found" }, 404);
    }
  });

  app.delete("/rules/:id", requireOwner, async (c) => {
    const id = z.uuid().safeParse(c.req.param("id"));
    if (!id.success) return c.json({ error: "not_found" }, 404);
    const result = await removeSenderRule(deps.db, c.get("ctx"), id.data, {
      actor: c.get("session").userId,
      now: deps.now(),
    });
    return result.kind === "removed" ? c.body(null, 204) : c.json({ error: "not_found" }, 404);
  });

  return app;
}
