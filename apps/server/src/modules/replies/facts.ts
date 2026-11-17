import type { ReplyFacts, ReplyLanguage } from "@ea/core";
import type { Transaction } from "kysely";
import { z } from "zod";

import type { DB, Db, TenantContext } from "../../platform/db";
import { replyFactsOf, type MailReplyFacts } from "../mail";
import { listLatestTriageByEmailIds, suspicionOf } from "../triage";

type DbOrTrx = Db | Transaction<DB>;

export interface LoadedReplyFacts {
  /** What `replyEligibility` reads. */
  facts: ReplyFacts;
  /** The stored mail facts that the job also needs (recipients, thread, folder). */
  mail: MailReplyFacts;
}

const languageOfFields = z.object({ language: z.enum(["pl", "en", "other"]) });

// The language of the newest result; a result with no valid language reads as "other" (an automatic draft refuses it, a tap
// uses the language of the owner).
function languageOf(fields: unknown): "pl" | "en" | "other" {
  const parsed = languageOfFields.safeParse(fields);
  return parsed.success ? parsed.data.language : "other";
}

// The facts of each mail for `replyEligibility` (F115 D4): the stored mail facts of the `mail` module, the three-state suspicion
// and the newest triage result. A mail with no result is not triaged; a mail that is not in this organization is absent.
// `ownerLocale` is the locale of the organization owner that the caller read (null reads as Polish in the rule).
export async function loadReplyFacts(
  db: DbOrTrx,
  ctx: TenantContext,
  emailIds: readonly string[],
  opts: { ownerLocale: ReplyLanguage | null }
): Promise<Map<string, LoadedReplyFacts>> {
  const loaded = new Map<string, LoadedReplyFacts>();
  const mails = await replyFactsOf(db, ctx, emailIds);
  if (mails.size === 0) return loaded;
  const ids = [...mails.keys()];
  const suspicion = await suspicionOf(db, ctx, ids);
  const results = new Map((await listLatestTriageByEmailIds(db, ctx, ids)).map((row) => [row.email_id, row]));
  for (const [emailId, mail] of mails) {
    const result = results.get(emailId);
    loaded.set(emailId, {
      mail,
      facts: {
        triaged: result !== undefined,
        category: result?.category ?? null,
        language: languageOf(result?.fields),
        fromJunk: mail.fromJunk,
        fromAddress: mail.fromAddress,
        ownAddresses: mail.ownAddresses,
        headers: mail.headers,
        suspicion: suspicion.get(emailId) ?? { state: "untriaged" },
        answered: mail.answered,
        receivedAt: mail.receivedAt,
        ownerLocale: opts.ownerLocale,
      },
    });
  }
  return loaded;
}
