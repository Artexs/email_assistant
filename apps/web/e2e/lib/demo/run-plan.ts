// The demo run plan: which seed mails the recording delivers, and the gate file that lets the demo server move mail.
// Pure. The recording classifies each delivered mail through the replay model, so a mail is a candidate only when the replay
// table has its answer. A seed that cannot give a live video is refused with a code; the caller prints it.
import { DEFAULT_THRESHOLD, decideCategory, movingCategories } from "@ea/core";

import { type DemoSeed } from "../../../../server/src/modules/lab";
import { type GateFile, gateFileName } from "../../../../server/src/modules/triage";
import { buildReplayTable, type ReplayEntry, replayKey } from "../../../../../tools/llm-replay/src/replay";

export interface DemoMail {
  key: string;
  from: string;
  subject: string;
  text: string | null;
  category: string;
  at: Date;
}

export interface DemoRunPlan {
  model: string;
  promptVersion: string;
  /** `office@<domain of mailbox A>`: the second mailbox of the recording. */
  mailboxB: string;
  /** 20 to 60 mails, newest first. */
  history: DemoMail[];
  /** 4 mails of 4 different categories. */
  shadow: DemoMail[];
  urgent: DemoMail;
  delegation: DemoMail & { delegateName: string; delegateAddress: string };
  undo: DemoMail;
  recommended: { category: string; threshold: number | null }[];
  overdueDelegation: { delegateName: string; subject: string } | null;
}

export type DemoRunPlanResult = { ok: true; plan: DemoRunPlan } | { ok: false; code: string };

const HISTORY_MIN = 20;
const HISTORY_MAX = 60;
const SHADOW_COUNT = 4;
const SHADOW_CATEGORIES = ["info", "notification", "spam", "needs_reply"] as const;
const UNDO_ORDER = ["notification", "spam", "info"] as const;
const MAX_REMINDERS = 2;

type Row = Record<string, unknown>;
type Pick = DemoMail & { entry: ReplayEntry };

const isRecord = (value: unknown): value is Row => typeof value === "object" && value !== null && !Array.isArray(value);

const textOf = (value: unknown): string | null => (typeof value === "string" ? value : null);

const timeOf = (value: unknown): number => {
  const time = typeof value === "string" || value instanceof Date ? new Date(value).getTime() : Number.NaN;
  return Number.isNaN(time) ? 0 : time;
};

const newestFirst = (a: { at: Date; key: string }, b: { at: Date; key: string }): number =>
  b.at.getTime() - a.at.getTime() || a.key.localeCompare(b.key);

const lower = (value: string | null): string => (value ?? "").trim().toLowerCase();

const withoutMail = (picks: readonly Pick[], used: readonly DemoMail[]): Pick[] =>
  picks.filter((pick) => !used.some((mail) => mail.key === pick.key));

// The newest result rows of the mails that the replay table answers: their model and prompt version.
function answeredRows(seed: DemoSeed, table: ReturnType<typeof buildReplayTable>): Row[] {
  const newest = new Map<unknown, Row>();
  for (const row of seed.tables.triage_results) {
    const known = newest.get(row.email_id);
    if (known === undefined || timeOf(row.created_at) >= timeOf(known.created_at)) newest.set(row.email_id, row);
  }
  const keyOfEmail = new Map(
    seed.tables.emails.map((email) => [email.id, replayKey(textOf(email.from_address), textOf(email.subject))])
  );
  return [...newest.entries()]
    .filter(([emailId]) => table.entries.has(keyOfEmail.get(emailId) ?? ""))
    .map(([, row]) => row);
}

// Of the files for the model and prompt version: non-provisional first, then the newest date. The files come sorted by name,
// and the sort keeps their order for a tie (`rank` in the triage evidence reads the same three keys).
export function bestGate(gates: readonly GateFile[], model: string, promptVersion: string): GateFile | undefined {
  return gates
    .filter((gate) => gate.role === "classifier" && gate.model === model && gate.promptVersion === promptVersion)
    .sort((a, b) => Number(a.provisional) - Number(b.provisional) || b.date.localeCompare(a.date))[0];
}

function candidatesOf(seed: DemoSeed, table: ReturnType<typeof buildReplayTable>, excluded: ReadonlySet<string>) {
  const byKey = new Map<string, Pick>();
  for (const email of seed.tables.emails) {
    const from = textOf(email.from_address);
    const subject = textOf(email.subject);
    if (from === null || subject === null || excluded.has(lower(from))) continue;
    const key = replayKey(from, subject);
    const entry = table.entries.get(key);
    if (entry === undefined) continue;
    const pick: Pick = {
      key,
      from,
      subject,
      text: textOf(email.body_text),
      category: entry.answer.category,
      at: new Date(timeOf(email.received_at)),
      entry,
    };
    const known = byKey.get(key);
    if (known === undefined || newestFirst(pick, known) < 0) byKey.set(key, pick);
  }
  return [...byKey.values()].sort(newestFirst);
}

const shortOf = (set: string): DemoRunPlanResult => ({ ok: false, code: `demo_seed_short ${set}` });

const asMail = (pick: Pick): DemoMail => ({
  key: pick.key,
  from: pick.from,
  subject: pick.subject,
  text: pick.text,
  category: pick.category,
  at: pick.at,
});

function overdueOf(seed: DemoSeed, mailboxId: unknown): DemoRunPlan["overdueDelegation"] {
  const { delegations, delegates, emails, mailbox_settings: settings } = seed.tables;
  const own = settings.find((row) => row.mailbox_id === mailboxId);
  const switches = isRecord(own?.tool_switches) ? own.tool_switches : {};
  // `remindNow` refuses `drafts_off` unless the mailbox is in `assist` with drafts on.
  if (own?.mode !== "assist" || switches.create_draft !== true) return null;
  const open = delegations
    .filter((row) => row.status === "overdue" && Number(row.reminders_sent ?? 0) < MAX_REMINDERS)
    .sort((a, b) => timeOf(b.created_at) - timeOf(a.created_at));
  for (const delegation of open) {
    const delegate = delegates.find((row) => row.id === delegation.delegate_id && row.active === true);
    const name = textOf(delegate?.name);
    const subject = textOf(emails.find((row) => row.id === delegation.email_id)?.subject);
    if (name !== null && subject !== null) return { delegateName: name, subject };
  }
  return null;
}

/**
 * Picks the mail of the recording from the seed. `gates` are the classifier gate files (sorted by name);
 * `productionPrompt` is the prompt version that the demo server runs.
 */
export function planDemoRun(seed: DemoSeed, gates: readonly GateFile[], productionPrompt: string): DemoRunPlanResult {
  const mailbox = seed.tables.mailboxes[0];
  const addressA = textOf(mailbox?.address);
  if (addressA === null || !addressA.includes("@")) return { ok: false, code: "demo_seed_no_mailbox" };
  const mailboxB = `office@${addressA.slice(addressA.lastIndexOf("@") + 1)}`;

  const table = buildReplayTable(seed);
  const rows = answeredRows(seed, table);
  const models = new Set(rows.map((row) => `${textOf(row.model) ?? ""}\n${textOf(row.prompt_version) ?? ""}`));
  if (models.size > 1) return { ok: false, code: "demo_seed_mixed_models" };
  const [model = "", promptVersion = ""] = [...models][0]?.split("\n") ?? [];
  if (rows.length > 0 && promptVersion !== productionPrompt) return { ok: false, code: "demo_prompt_mismatch" };

  const gate = bestGate(gates, model, productionPrompt);
  if (gate === undefined) return { ok: false, code: "demo_gate_missing" };
  const recommended = movingCategories
    .filter((category) => gate.categories[category].decision === "go")
    .map((category) => ({ category: category as string, threshold: gate.categories[category].threshold }));
  if (recommended.length === 0) return { ok: false, code: "demo_nothing_recommended" };

  // A new mailbox has the default threshold, so a pick needs at least that confidence.
  const picks = candidatesOf(seed, table, new Set([lower(addressA), lower(mailboxB)])).filter(
    (pick) => decideCategory(pick.entry.answer, {}).category !== "unsure"
  );

  const urgent = picks.find((pick) => pick.category === "urgent");
  if (urgent === undefined) return shortOf("urgent");

  const activeDelegates = new Map(
    seed.tables.delegates.filter((row) => row.active === true).map((row) => [textOf(row.name), textOf(row.email)])
  );
  const delegationPick = picks.find((pick) => {
    const name = pick.entry.delegateName;
    const task = pick.entry.answer.fields.task;
    return pick.category === "delegation" && name !== null && activeDelegates.has(name) && task !== null && task !== "";
  });
  const delegateName = delegationPick?.entry.delegateName ?? null;
  const delegateAddress = delegateName === null ? null : (activeDelegates.get(delegateName) ?? null);
  if (delegationPick === undefined || delegateName === null || delegateAddress === null) return shortOf("delegation");

  // The undo mail must keep its category under the threshold of the gate, else `decideCategory` makes it `unsure`.
  let undo: Pick | undefined;
  for (const category of UNDO_ORDER) {
    const entry = recommended.find((row) => row.category === category);
    if (entry === undefined) continue;
    const policy = { [category]: { threshold: entry.threshold ?? DEFAULT_THRESHOLD } };
    undo = picks.find(
      (pick) => pick.category === category && decideCategory(pick.entry.answer, policy).category === category
    );
    if (undo !== undefined) break;
  }
  if (undo === undefined) return shortOf("undo");

  const used: DemoMail[] = [urgent, delegationPick, undo];
  const shadow: Pick[] = [];
  for (const category of SHADOW_CATEGORIES) {
    const pick = withoutMail(picks, used).find((candidate) => candidate.category === category);
    if (pick !== undefined) {
      shadow.push(pick);
      used.push(pick);
    }
  }
  if (shadow.length < SHADOW_COUNT) return shortOf("shadow");

  const history = withoutMail(picks, used).filter(
    (pick) => pick.category !== "urgent" && pick.category !== "delegation"
  );
  if (history.length < HISTORY_MIN) return shortOf("history");

  return {
    ok: true,
    plan: {
      model,
      promptVersion,
      mailboxB,
      history: history.slice(0, HISTORY_MAX).map(asMail),
      shadow: shadow.map(asMail),
      urgent: asMail(urgent),
      delegation: { ...asMail(delegationPick), delegateName, delegateAddress },
      undo: asMail(undo),
      recommended,
      overdueDelegation: overdueOf(seed, mailbox?.id),
    },
  };
}

/**
 * The gate file of the demo server: the source's categories, decisions and thresholds under the key of the replay server
 * (`runningEvidenceKey` for the `openai` provider, the model, endpoint `own`, host `127.0.0.1` and no effort). The audit is
 * `done` so the file is not provisional; `sourceProvisional` says whether the source was, for the upload line.
 */
export function demoGateCopy(
  source: GateFile,
  replay: { model: string; host: "127.0.0.1" }
): { file: GateFile; fileName: string; sourceProvisional: boolean } {
  const file: GateFile = {
    ...source,
    provider: "openai",
    model: replay.model,
    endpoint: "own",
    host: replay.host,
    reasoningEffort: null,
    provisional: false,
    audit: "done",
  };
  const fileName = gateFileName({
    role: "classifier",
    endpoint: "own",
    promptVersion: file.promptVersion,
    model: file.model,
    reasoningEffort: null,
    scenario: file.scenario,
    version: file.version,
  });
  return { file, fileName, sourceProvisional: source.provisional };
}
