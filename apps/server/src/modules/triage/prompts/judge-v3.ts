import { buildUserPrompt as buildUserPromptV1, type RubricKind } from "./judge-v1";
import { buildSystemPrompt as buildSystemPromptV2 } from "./judge-v2";

// Any change to the text below needs a new file and version id (`judge-v4.ts`).
// judge-v3 = judge-v2 plus the older mail of the thread. The drafter reads the mail with its thread quoted below it, but
// judge-v2 saw only the newest mail. So a draft that named a term of the older mail (a date, an amount, a condition)
// looked invented to judge-v2 and failed `no_invented_commitment`; the same draft passed when the judge saw the thread
// (`spec/features/active/F115-e6a-reply-drafts/tuning-1.md` § drafter-v3). The rubric, the gap rules and the schema are
// those of judge-v2.
export const PROMPT_VERSION = "judge-v3";

export { judgeSchema, type JudgeAnswer, type RubricKind, rubricItems, rubricKinds } from "./judge-v1";

const DATA_BLOCKS = "Data blocks:\n";
const THREAD_RULE =
  '- The mail may end with older mail of the same thread, quoted: each line starts with "> ". A fact, a date, an amount or a term in the older mail is held by the mail.\n';

export function buildSystemPrompt(kind: RubricKind): string {
  return buildSystemPromptV2(kind).replace(DATA_BLOCKS, `${DATA_BLOCKS}${THREAD_RULE}`);
}

// The older mails go below the newest mail as quoted lines, oldest first: the form in which the drafter reads them.
function bodyWithThread(body: string, thread: readonly { from: string; body: string }[]): string {
  if (thread.length === 0) return body;
  const quoted = thread.map((older) =>
    [`${older.from} wrote:`, ...older.body.split("\n")].map((line) => `> ${line}`.trimEnd()).join("\n")
  );
  return [body, ...quoted].join("\n\n");
}

export function buildUserPrompt(input: Parameters<typeof buildUserPromptV1>[0]): string {
  const { thread, ...rest } = input;
  return buildUserPromptV1({ ...rest, mail: { ...input.mail, body: bodyWithThread(input.mail.body, thread ?? []) } });
}
