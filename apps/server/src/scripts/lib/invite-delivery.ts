import type { UserLocale } from "@ea/core";

import { createAuth } from "../../platform/auth";
import { createAuthMailer } from "../../platform/auth-mail";
import type { CliRawOutput } from "../../platform/cli";
import { authMailSettings, type Config, webTrustedOrigins } from "../../platform/config";
import type { Db } from "../../platform/db";
import { auditWebEvent, termsAcceptedHandler } from "../../web";

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
  out: CliRawOutput;
}

/** Makes a 24 h setup link, then mails it (sender on, no --print) or prints it to stdout. Returns the exit code. The link never goes to the log. */
export async function deliverInvite(input: InviteDeliveryInput): Promise<number> {
  const { config, db, orgId, userId, email, locale, print, out } = input;
  const baseUrl = config.WEB_BASE_URL;
  const secret = config.WEB_AUTH_SECRET;
  if (baseUrl === undefined || secret === undefined) {
    out.fail("WEB_BASE_URL is empty: the web is off; set WEB_BASE_URL and WEB_AUTH_SECRET first");
    return 1;
  }

  let link: string | undefined;
  const handle = createAuth({
    databaseUrl: config.DATABASE_URL,
    baseUrl,
    secret,
    trustedOrigins: [baseUrl, ...webTrustedOrigins(config)],
    onEvent: auditWebEvent(db),
    onTermsAccepted: termsAcceptedHandler(db, () => new Date()),
    resetLinkTtlSeconds: 86_400,
    sendResetPassword: async ({ url }) => {
      link = url;
    },
  });
  try {
    await handle.auth.api.requestPasswordReset({ body: { email, redirectTo: `${baseUrl}/setup` } });
    if (link === undefined) {
      out.fail("no link was produced");
      return 1;
    }

    const settings = authMailSettings(config);
    if (settings !== null && !print) {
      const result = await createAuthMailer(settings).send({ kind: "invite", userId, to: email, locale, url: link });
      if (!result.ok) {
        out.fail(
          `invite mail failed (${result.code}): run bun run web:invite --org-id ${orgId} --user-id ${userId} to send the link again`
        );
        return 1;
      }
      out.print(`invite mail sent to user ${userId}`);
      return 0;
    }

    out.write(
      [
        "Open this link within 24 hours:",
        link,
        "The link works once. Do not share it. If this user already has a password, the link replaces it and ends every signed-in session.",
        "",
      ].join("\n")
    );
    out.print(`invite link made for user ${userId}`);
    return 0;
  } finally {
    await handle.close();
  }
}
