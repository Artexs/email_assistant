// What both triage paths hand to the classifier for one stored mail: the thread context, the extras of a v3 prompt and the
// prompt choice (it lives apart from `triageOne` so the history check classifies a mail exactly as triage does).
import type { TenantContext } from "../../platform/db";
import { isTestMail, listThreadContext, type StoredEmail, type TestMailRule } from "../mail";

import type { ClassifierEmail, ClassifierExtras } from "./classifier";
import { type ClassifierExtrasInput, loadClassifierExtras } from "./extras-reader";
import { type ClassifierPromptChoice, classifierVersions, productionClassifierChoice } from "./prompts";
import type { TriageMailbox } from "./service";

export interface ClassifierInputDeps {
  db: Parameters<typeof listThreadContext>[0];
  testMail: TestMailRule;
  /** Absent: the production prompt. */
  prompt?: ClassifierPromptChoice;
  /** The profile reader of the composition root (`classifier-v4` part `profile`). */
  readProfile?: ClassifierExtrasInput["readProfile"];
}

export async function buildClassifierInput(
  deps: ClassifierInputDeps,
  ctx: TenantContext,
  mailbox: TriageMailbox,
  email: StoredEmail,
  suspiciousReasons: readonly string[]
): Promise<{ choice: ClassifierPromptChoice; classifierEmail: ClassifierEmail; extras: ClassifierExtras | undefined }> {
  const threadRows = await listThreadContext(deps.db, ctx, mailbox.id, email.thread_key, email.received_at, email.id, {
    syntheticOnly: isTestMail(
      { messageIdHeader: email.message_id_header, fromAddress: email.from_address },
      deps.testMail
    )
      ? { testMail: deps.testMail }
      : false,
  });
  const choice = deps.prompt ?? productionClassifierChoice();
  // Only a prompt that reads extras (v3) gets the user's data: v2 triage runs no new query. The part list is the one of the prompt.
  const extras = classifierVersions[choice.version].readsExtras
    ? await loadClassifierExtras(deps.db, ctx, {
        mailbox: { id: mailbox.id, urgencyProfile: mailbox.urgencyProfile },
        email,
        parts: choice.parts,
        timezone: mailbox.timezone,
        testMail: deps.testMail,
        suspicious: suspiciousReasons,
        ...(deps.readProfile === undefined ? {} : { readProfile: deps.readProfile }),
      })
    : undefined;
  const classifierEmail: ClassifierEmail = {
    from: email.from_address,
    to: email.to_addresses,
    cc: email.cc_addresses,
    subject: email.subject,
    receivedAt: email.received_at,
    bodyText: email.body_text,
    thread: threadRows.reverse().map((row) => ({
      from: row.from_address,
      subject: row.subject,
      receivedAt: row.received_at,
      bodyExcerpt: row.body_excerpt,
    })),
  };
  return { choice, classifierEmail, extras };
}
