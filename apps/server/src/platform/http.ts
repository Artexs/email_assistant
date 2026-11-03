import { Hono } from "hono";

import { createLog } from "./log";

const log = createLog("http");

export interface HttpDeps {
  checkDb: () => Promise<boolean>;
}

export function createApp(deps: HttpDeps): Hono {
  const app = new Hono();

  app.get("/health", async (c) => {
    const dbUp = await deps.checkDb();
    return dbUp ? c.json({ status: "ok", db: "up" }, 200) : c.json({ status: "error", db: "down" }, 503);
  });

  app.onError((error, c) => {
    log.error(error.message);
    return c.json({ error: "internal" }, 500);
  });

  return app;
}
