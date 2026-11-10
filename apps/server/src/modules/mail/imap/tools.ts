// Test and dev tools only: not on the `MailProvider` port.
import { MailFolderMissingError } from "../port";

import { connectImapClient, toMailError, type ImapConnectOptions } from "./client";

/** APPENDs a raw RFC 822 message to `folder`. Creates the folder when it is missing, unless `create` is false (then it throws MailFolderMissingError). */
export async function appendRaw(
  opts: ImapConnectOptions,
  folder: string,
  raw: string,
  flags: string[] = [],
  create = true
): Promise<void> {
  const client = await connectImapClient(opts);
  try {
    const exists = (await client.list()).some((entry) => entry.path === folder);
    if (!exists) {
      if (!create) throw new MailFolderMissingError();
      await client.mailboxCreate(folder);
    }
    await client.append(folder, raw, flags);
  } catch (error) {
    throw toMailError(error, "append");
  } finally {
    await client.logout().catch(() => client.close());
  }
}
