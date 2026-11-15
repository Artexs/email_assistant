import type { Transaction } from "kysely";

import type { SecretBox } from "../../platform/crypto";
import type { DB, Db } from "../../platform/db";

import { decodeOAuthSecret } from "./oauth/secret-store";
import { listCredentialsPage } from "./repo";

const DEFAULT_PAGE = 200;

export interface CredentialCounts {
  ok: number;
  failed: number;
}

// Does the configured key open every stored mailbox secret? Used by the restore (`deploy/restore.sh`) before the server starts,
// and on a new host. Cross-organization: it takes no TenantContext (docs/code-patterns.md § Data access). The decrypted text is
// dropped at once; the result is two counts. A row that cannot be opened (another key, another key version, changed data,
// an OAuth secret with a wrong shape) counts as `failed`: no error leaves this function for a bad row, and no error text is kept.
// A database error still throws: the caller must not report `ok=0 failed=0` for a table it could not read.
export async function countDecryptableCredentials(
  db: Db | Transaction<DB>,
  secrets: SecretBox,
  opts: { pageSize?: number } = {}
): Promise<CredentialCounts> {
  const pageSize = opts.pageSize ?? DEFAULT_PAGE;
  const counts: CredentialCounts = { ok: 0, failed: 0 };
  let after: string | null = null;
  for (;;) {
    const rows = await listCredentialsPage(db, { after, limit: pageSize });
    for (const row of rows) {
      try {
        const clear = secrets.decrypt(
          { ciphertext: row.encrypted_secret, keyVersion: row.key_version },
          `mailbox:${row.mailbox_id}`
        );
        if (row.secret_kind === "oauth") decodeOAuthSecret(clear);
        counts.ok += 1;
      } catch {
        counts.failed += 1;
      }
    }
    const last = rows.at(-1);
    if (last === undefined || rows.length < pageSize) return counts;
    after = last.mailbox_id;
  }
}
