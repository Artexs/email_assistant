import { isUnsupportedAuthMechanism } from "../imap/client";
import { MailAuthError, SmtpSendError, type MailSender } from "../port";

// How a refused login of an OAuth mailbox becomes a reason. Only `open.ts` calls this: a password mailbox
// never gets a reason. Nothing here reads the message or the `cause` of an error; they can hold the access token.

/** The login did not pass: a refusal (`MailAuthError` without a reason), or a server that offers no XOAUTH2 at all. */
export function isLoginRefused(error: unknown): boolean {
  return (error instanceof MailAuthError && error.reason === undefined) || isUnsupportedAuthMechanism(error);
}

/** A fresh token was refused too (or the server has no XOAUTH2): the provider has the protocol off for this account. */
export function protocolDisabled(): MailAuthError {
  return new MailAuthError("mail login refused", { reason: "protocol_disabled" });
}

const responseCodeOf = (error: unknown): number | null => {
  const code =
    typeof error === "object" && error !== null ? (error as { responseCode?: unknown }).responseCode : undefined;
  return typeof code === "number" ? code : null;
};

/**
 * The SMTP sender of an OAuth mailbox. A refused login at send time gets the reason `protocol_disabled` (the token is minutes old),
 * unless the reply to AUTH was a 4xx: a temporary refusal (421) says nothing about the grant, so it is a soft login error and the
 * send retries. nodemailer raises EAUTH for every non-2xx reply to AUTH.
 */
export function guardOAuthSender(sender: MailSender): MailSender {
  return {
    close: () => sender.close(),
    async send(input) {
      try {
        return await sender.send(input);
      } catch (error) {
        if (!(error instanceof MailAuthError) || error.reason !== undefined) throw error;
        const code = responseCodeOf(error.cause);
        if (code !== null && code >= 400 && code < 500) {
          throw new SmtpSendError("login", "EAUTH", code, false, true);
        }
        throw protocolDisabled();
      }
    },
  };
}
