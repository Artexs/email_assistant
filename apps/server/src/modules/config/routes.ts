import {
  autoBodySchema,
  barCategories,
  modeBodySchema,
  switchableSyncFolderKeys,
  switchBodySchema,
  syncFolderBodySchema,
  toolSwitchNames,
  type BarCategory,
  type GateView,
  type SettingsWebChange,
  type SwitchableSyncFolderKey,
} from "@ea/core";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";

import type { Db, TenantContext } from "../../platform/db";
import { parseBody, requireOwner, type ApiEnv } from "../../platform/http";

import { getMailboxSettings } from "./repo";
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
