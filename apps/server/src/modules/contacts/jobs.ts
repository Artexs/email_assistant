import { errorFields } from "../../platform/errors";
import { createLog } from "../../platform/log";
import { listSyncTargets, type TestMailRule } from "../mail";
import { isOrgSuspended } from "../tenancy";

import { refreshMailboxProfiles, type RefreshDeps } from "./refresh";

const log = createLog("contacts");

export interface ContactsRefreshJobDeps extends RefreshDeps {
  testMail: TestMailRule;
  now(): Date;
  // Only for tests of an error outside the pass.
  refresh?: typeof refreshMailboxProfiles;
}

export interface ContactsRefreshResult {
  mailboxes: number;
  // Mailboxes that the flag `sender_context` or a busy lock skipped.
  skipped: number;
  written: number;
  unchanged: number;
  zeroed: number;
  mailboxErrors: number;
}

export interface ContactsRefreshJob {
  // `contacts.refresh`: the recompute of the sender profiles, hourly at minute 7. It needs no model: it runs with the scope off.
  run(): Promise<ContactsRefreshResult>;
}

// The job gates itself: only active mailboxes of organizations that are not suspended (`listSyncTargets`), and a suspend during the
// run stops the next mailbox. The flag `sender_context` is read per organization inside the pass. An error of one mailbox is
// logged by code and counted; the next mailbox still runs. The log lines hold ids and counts, never an address, a hash or a subject.
export function createContactsRefreshJob(deps: ContactsRefreshJobDeps): ContactsRefreshJob {
  return {
    async run() {
      const total: ContactsRefreshResult = {
        mailboxes: 0,
        skipped: 0,
        written: 0,
        unchanged: 0,
        zeroed: 0,
        mailboxErrors: 0,
      };
      const targets = await listSyncTargets(deps.db);
      for (const { orgId, mailboxId } of targets) {
        const ctx = { orgId };
        try {
          if (await isOrgSuspended(deps.db, ctx)) continue;
          const started = performance.now();
          const out = await (deps.refresh ?? refreshMailboxProfiles)(deps, ctx, mailboxId, { now: deps.now() });
          if (out.skipped) {
            total.skipped += 1;
            continue;
          }
          total.mailboxes += 1;
          total.written += out.written;
          total.unchanged += out.unchanged;
          total.zeroed += out.zeroed;
          log.with({ org_id: orgId, mailbox_id: mailboxId }).info("contacts_refresh_done", {
            count: out.written,
            unchanged: out.unchanged,
            zeroed: out.zeroed,
            duration_ms: Math.round(performance.now() - started),
          });
        } catch (error) {
          total.mailboxErrors += 1;
          log
            .with({ org_id: orgId, mailbox_id: mailboxId })
            .error("contacts_refresh_mailbox_failed", errorFields(error));
        }
      }
      return total;
    },
  };
}
