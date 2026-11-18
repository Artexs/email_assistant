import {
  autoBodySchema,
  barCategories,
  loopSwitchNames,
  loopWaitBodySchema,
  modeBodySchema,
  replySwitchNames,
  ruleBodySchema,
  rulesQuerySchema,
  sentSyncBodySchema,
  switchableSyncFolderKeys,
  switchBodySchema,
  syncFolderBodySchema,
  toolSwitchNames,
  urgencyBodySchema,
  type BarCategory,
  type EvidenceBlock,
  type GateView,
  type RuleView,
  type SettingsWebChange,
  type SwitchableSyncFolderKey,
} from "@ea/core";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";

import type { Db, TenantContext } from "../../platform/db";
import { parseBody, parseQuery, requireOwner, ValidationError, type ApiEnv } from "../../platform/http";
import { isFeatureOn } from "../tenancy";

import { rulesDocs, settingsDocs } from "./api-docs";
import { getMailboxSettings, listSenderRuleRows, type SenderRuleRow } from "./repo";
import { addSenderRule, removeSenderRule } from "./rules";
import {
  setLoopWaitDays,
  setMode,
  setToolSwitch,
  setUrgencyProfile,
  OauthMailboxError,
  SettingsNotFoundError,
  type SettingsChange,
} from "./service";
import { buildSettingsView, type SettingsViewDeps } from "./view";

// `blocks`: why the evidence gate refused (flag `trust_ladder` on); absent when the real-label gate refused.
export type AutoGateOutcome =
  | { kind: "changed"; change: SettingsChange }
  | { kind: "refused"; gate: GateView; blocks?: EvidenceBlock[] };

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
  setSentSync(
    ctx: TenantContext,
    mailboxId: string,
    input: { enabled: boolean; actor: string; now: Date }
  ): Promise<"changed" | "same" | "not_found" | "flag_off">;
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
      // Reply drafts are for password mailboxes only; the card shows the switch disabled for an OAuth mailbox.
      if (error instanceof OauthMailboxError) {
        throw new ValidationError([{ path: "reply_drafts", code: "custom", message: "oauth_mailbox" }]);
      }
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

  app.get("/settings/:mailboxId", settingsDocs.getSettings, async (c) => {
    const id = mailboxIdOf(c);
    if (!id || !(await ensureSettings(c, id))) return notFound(c);
    return guarded(c, async () => c.json(await buildSettingsView(deps, c.get("ctx"), id)));
  });

  app.patch("/settings/:mailboxId/mode", requireOwner, settingsDocs.patchSettingsMode, async (c) => {
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

  app.patch("/settings/:mailboxId/switches/:name", requireOwner, settingsDocs.patchSettingsSwitch, async (c) => {
    const id = mailboxIdOf(c);
    const name = member([...toolSwitchNames, ...loopSwitchNames, ...replySwitchNames], c.req.param("name"));
    if (!id || !name || !(await ensureSettings(c, id))) return notFound(c);
    // A switch of the open loops is hidden with the flag: it looks like an unknown switch.
    const loopSwitch = member(loopSwitchNames, name) !== null;
    if (loopSwitch && !(await isFeatureOn(deps.db, c.get("ctx"), "open_loops"))) return notFound(c);
    // The same for the reply switch: it exists only while the flag `reply_drafts` is on.
    if (member(replySwitchNames, name) !== null && !(await isFeatureOn(deps.db, c.get("ctx"), "reply_drafts"))) {
      return notFound(c);
    }
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

  // The wait of the open loops. A hidden feature (flag off) looks absent. The owner only; a member gets 403 before any query.
  app.patch("/settings/:mailboxId/loop-wait", requireOwner, settingsDocs.patchSettingsLoopWait, async (c) => {
    const id = mailboxIdOf(c);
    if (!id || !(await isFeatureOn(deps.db, c.get("ctx"), "open_loops")) || !(await ensureSettings(c, id))) {
      return notFound(c);
    }
    const body = await parseBody(c, loopWaitBodySchema);
    return guarded(c, async () => {
      const result = await setLoopWaitDays(deps.settings.db, c.get("ctx"), id, body.days, {
        userId: c.get("session").userId,
        via: "web",
      });
      return respond(c, id, { changed: result.changed, expired: 0 });
    });
  });

  app.patch("/settings/:mailboxId/auto/:category", requireOwner, settingsDocs.patchSettingsAuto, async (c) => {
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
      if (result.kind === "refused") {
        return c.json(
          { error: "no_go" as const, gate: result.gate, ...(result.blocks ? { blocks: result.blocks } : {}) },
          409
        );
      }
      return respond(c, id, result.change);
    });
  });

  app.put("/settings/:mailboxId/urgency", requireOwner, settingsDocs.putSettingsUrgency, async (c) => {
    const id = mailboxIdOf(c);
    if (!id || !(await ensureSettings(c, id))) return notFound(c);
    const body = await parseBody(c, urgencyBodySchema);
    return guarded(c, async () => {
      await setUrgencyProfile(deps.settings.db, c.get("ctx"), id, body.profile, {
        via: "web",
        userId: c.get("session").userId,
      });
      return c.json(await buildSettingsView(deps, c.get("ctx"), id));
    });
  });

  app.patch("/settings/:mailboxId/sync-folders/:key", requireOwner, settingsDocs.patchSettingsSyncFolder, async (c) => {
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

  // A hidden feature (flag off) looks absent: `flag_off` answers 404 like an unknown mailbox.
  app.patch("/settings/:mailboxId/sent-sync", requireOwner, settingsDocs.patchSettingsSentSync, async (c) => {
    const id = mailboxIdOf(c);
    if (!id || !(await ensureSettings(c, id))) return notFound(c);
    const body = await parseBody(c, sentSyncBodySchema);
    return guarded(c, async () => {
      const result = await deps.setSentSync(c.get("ctx"), id, {
        enabled: body.enabled,
        actor: c.get("session").userId,
        now: deps.now(),
      });
      if (result === "not_found" || result === "flag_off") return notFound(c);
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
  app.get("/rules", rulesDocs.getRules, async (c) => {
    const query = parseQuery(c, rulesQuerySchema);
    const rows = await listSenderRuleRows(deps.db, c.get("ctx"), { mailboxId: query.mailboxId });
    return c.json(rows.map(ruleView));
  });

  app.post("/rules", requireOwner, rulesDocs.postRule, async (c) => {
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

  app.delete("/rules/:id", requireOwner, rulesDocs.deleteRule, async (c) => {
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
