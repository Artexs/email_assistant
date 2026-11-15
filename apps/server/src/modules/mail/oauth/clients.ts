import { type Config, mailOAuthApp, mailOAuthProviderIds } from "../../../platform/config";

import { createMailOAuthClient, type MailOAuthClientOptions, type MailOAuthClients } from "./client";
import { mailOAuthProviders, type MailOAuthProvider, type MailOAuthProviderSpec } from "./providers";

export interface MailOAuthClientsDeps extends MailOAuthClientOptions {
  /** A test passes its own registry (the fake token server). The default is the constant registry (D6). */
  specs?: Readonly<Record<MailOAuthProvider, MailOAuthProviderSpec>>;
}

/** One client for each provider that `mailOAuthConfigured` accepts; the others are absent (a provider without keys has no client). */
export function createMailOAuthClients(config: Config, deps: MailOAuthClientsDeps = {}): MailOAuthClients {
  const specs = deps.specs ?? mailOAuthProviders;
  const clients: MailOAuthClients = {};
  for (const provider of mailOAuthProviderIds) {
    const app = mailOAuthApp(config, provider);
    if (app !== null) {
      clients[provider] = createMailOAuthClient(specs[provider], app, {
        ...(deps.fetchFn === undefined ? {} : { fetchFn: deps.fetchFn }),
        ...(deps.timeoutMs === undefined ? {} : { timeoutMs: deps.timeoutMs }),
      });
    }
  }
  return clients;
}
