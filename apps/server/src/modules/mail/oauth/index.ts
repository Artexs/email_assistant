export {
  aadstsOf,
  classifyTokenError,
  createMailOAuthClient,
  OAUTH_TIMEOUT_MS,
  OAuthGrantError,
  OAuthSoftError,
  type MailOAuthClient,
  type MailOAuthClientApp,
  type MailOAuthClientOptions,
  type MailOAuthClients,
  type TokenAnswer,
} from "./client";
export { createMailOAuthClients, type MailOAuthClientsDeps } from "./clients";
export {
  mailOAuthProviders,
  missingResourceScopes,
  requiredResourceScopes,
  type MailOAuthProvider,
  type MailOAuthProviderSpec,
} from "./providers";
