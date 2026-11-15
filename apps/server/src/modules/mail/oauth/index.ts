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
export {
  finishOAuthCallback,
  type CallbackDeps,
  type CallbackInput,
  type CallbackResult,
  type OAuthGrant,
  type OAuthRefusalCode,
} from "./callback";
export { applyOAuthGrant, type ApplyGrantDeps, type ApplyResult, type OAuthResultCode } from "./apply";
export { mailOAuthCallbackRoutes, type MailOAuthCallbackDeps } from "./callback-route";
export {
  decodeOAuthSecret,
  encodeOAuthSecret,
  readOAuthSecret,
  saveOAuthSecret,
  withMailboxOAuthLock,
  type OAuthSecret,
} from "./secret-store";
export { parseIdTokenClaims, type IdTokenClaims } from "./id-token";
export { createMailOAuthClients, type MailOAuthClientsDeps } from "./clients";
export {
  mailOAuthFlag,
  mailOAuthProviders,
  missingResourceScopes,
  requiredResourceScopes,
  type MailOAuthProvider,
  type MailOAuthProviderSpec,
} from "./providers";
export { mailOAuthRoutes, type MailOAuthRouteDeps } from "./routes";
export { mailOAuthOptions, startMailOAuth, type MailOAuthStartDeps, type StartResult } from "./start";
export {
  consumeOAuthState,
  createOAuthState,
  OAUTH_STATE_CAP,
  OAUTH_STATE_TTL_MS,
  OAuthStateRefusedError,
  type ConsumeResult,
  type OAuthStart,
} from "./state";
