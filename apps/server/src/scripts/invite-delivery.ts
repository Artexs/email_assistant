import type { UserLocale } from "@ea/core";

import { createAuth } from "../platform/auth";
import { createAuthMailer } from "../platform/auth-mail";
import { authMailSettings, type Config, webTrustedOrigins } from "../platform/config";
import type { Db } from "../platform/db";
import type { createLog } from "../platform/log";
import { auditWebEvent } from "../web";

export interface InviteDeliveryInput {
  /** WEB_BASE_URL and WEB_AUTH_SECRET are checked by the caller. */
  config: Config;
  db: Db;
  orgId: string;
  userId: string;
  email: string;
  locale: UserLocale;
  /** --print: print even when the sender is on. */
  print: boolean;
  log: ReturnType<typeof createLog>;
}

/** Makes a 24 h setup link, then mails it (sender on, no --print) or prints it to stdout. Returns the exit code. The link never goes to the log. */
export async function deliverInvite(input: InviteDeliveryInput): Promise<number> {
  const { config, db, orgId, userId, email, locale, print, log } = input;
  const baseUrl = config.WEB_BASE_URL;
  const secret = config.WEB_AUTH_SECRET;
  if (baseUrl === undefined || secret === undefined) {
    log.error("WEB_BASE_URL is empty: the web is off; set WEB_BASE_URL and WEB_AUTH_SECRET first");
    return 1;
  }

  let link: string | undefined;
  const handle = createAuth({
    databaseUrl: config.DATABASE_URL,
    baseUrl,
    secret,
    trustedOrigins: [baseUrl, ...webTrustedOrigins(config)],
    onEvent: auditWebEvent(db),
    resetLinkTtlSeconds: 86_400,
    sendResetPassword: async ({ url }) => {
      link = url;
    },
  });
  try {
    await handle.auth.api.requestPasswordReset({ body: { email, redirectTo: `${baseUrl}/setup` } });
    if (link === undefined) {
      log.error("no link was produced");
      return 1;
    }

    const settings = authMailSettings(config);
    if (settings !== null && !print) {
      const result = await createAuthMailer(settings).send({ kind: "invite", userId, to: email, locale, url: link });
      if (!result.ok) {
        log.error(
          `invite mail failed (${result.code}): run bun run web:invite --org-id ${orgId} --user-id ${userId} to send the link again`
        );
        return 1;
      }
      log.info(`invite mail sent to user ${userId}`);
      return 0;
    }

    process.stdout.write(
      [
        "Open this link within 24 hours:",
        link,
        "The link works once. Do not share it. If this user already has a password, the link replaces it and ends every signed-in session.",
        "",
      ].join("\n")
    );
    log.info(`invite link made for user ${userId}`);
    return 0;
  } finally {
    await handle.close();
  }
}
