import { serversFor, type ConnectMailboxBody } from "@ea/core";

import type { TenantContext } from "../../platform/db";

import { connectMailbox, type ConnectDeps } from "./connect";
import { isLocalMailHost } from "./host-check";
import { HostNotAllowedError, type MailServerInfo } from "./port";

// The host rule runs before any network call. The preset hosts are public and never hit it.
export async function connectMailboxRequest(
  deps: ConnectDeps & { allowLocalHosts: boolean },
  ctx: TenantContext,
  input: { body: ConnectMailboxBody; actor: string }
): Promise<{ mailboxId: string; info: MailServerInfo }> {
  const { body, actor } = input;
  const servers = serversFor(body);
  if (!deps.allowLocalHosts && (isLocalMailHost(servers.imapHost) || isLocalMailHost(servers.smtpHost))) {
    throw new HostNotAllowedError();
  }
  return connectMailbox(
    deps,
    ctx,
    { address: body.address, password: body.password, secretKind: body.secretKind, ...servers },
    { actor, via: "web" }
  );
}
