import { checkDb } from "../platform/db";
import { createApp } from "../platform/http";
import { webDeps } from "../web";

import type { StartContext } from "./context";
import type { JobsStart } from "./jobs";
import type { MailStart } from "./mail";
import type { OperatorStart } from "./operator";
import { createShutdown } from "./shutdown";
import type { TriageStart } from "./triage";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// The first heartbeat, the web app, the server, the shutdown and the signal handlers, then the line that says the server is ready.
export function startHttp(
  ctx: StartContext,
  { heartbeat }: MailStart,
  { operator }: OperatorStart,
  triage: TriageStart,
  { scopeOfActions }: JobsStart
): void {
  const { config, db, log, scheduler, runs, secrets, mailOAuth, late } = ctx;
  const { gate, scopeOfSends, stylePreview, replySamples } = triage;
  void heartbeat.tick();

  const bot = late.telegram;

  const web = webDeps(config, db, {
    secrets,
    actionsScope: scopeOfActions,
    sendScope: scopeOfSends,
    botUsername: bot ? () => bot.botUsername() : null,
    mailOAuthClients: mailOAuth.clients,
    mailOAuthLogin: { oauthTokens: mailOAuth.tokens },
    gate,
    stylePreview,
    replySamples,
    onAuthMailFailed: (tenant, userId, kind, code) => operator.authMailFailed(tenant, userId, kind, code, new Date()),
  });
  const app = createApp({ checkDb: () => checkDb(db), web });
  // idleTimeout: the connect route runs a mailbox login inside the request; Bun's default is 10 s.
  const server = Bun.serve({ port: config.PORT, idleTimeout: 90, fetch: app.fetch });

  // The steps are read at shutdown time: `late.telegram` is set late and must be seen as it is then.
  const shutdown = createShutdown(() => {
    const runtime = late.telegram;
    return {
      stopScheduler: () => scheduler.stop(),
      stopTelegram: runtime === null ? null : () => runtime.stop(),
      settled: () => runs.settled(),
      stopServer: () => server.stop(),
      closeWeb: async () => {
        await web?.close();
      },
      destroyDb: () => db.destroy(),
      exit: (code) => process.exit(code),
      sleep,
    };
  });

  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());

  // After the handlers: this line says the server is ready. A SIGTERM before the handlers exist would kill the process with exit 143.
  log.info("server_listening", { port: server.port });
}
