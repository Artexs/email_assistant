import { classifierCategories } from "@ea/core";

import { type ClassifierDelegate, type ClassifierEmail, classifyEmail } from "../modules/triage";
import { llmRoleTable, loadConfig } from "../platform/config";
import { describeError } from "../platform/errors";
import { createLlmClient, type LlmUsage } from "../platform/llm";
import { createLog } from "../platform/log";

import { greetingCall, parseLlmCheckArgs, usage } from "./llm-check-args";

const log = createLog("llm-check");

// Made-up mail: example.com addresses, no real data.
const SAMPLE_EMAIL: ClassifierEmail = {
  from: "anna.nowak@example.com",
  to: ["manager@example.com"],
  cc: [],
  subject: "Meeting on Thursday?",
  receivedAt: new Date("2026-01-12T09:00:00Z"),
  bodyText: "Hi, can we meet on Thursday at 10:00 to talk about the Q1 plan? Please confirm. Anna",
  thread: [],
};

// Made-up task mail and delegates for `--delegates`: the v2 schema with a nullable enum.
const DELEGATE_EMAIL: ClassifierEmail = {
  ...SAMPLE_EMAIL,
  subject: "Invoice 14/2026",
  bodyText: "Hi, please have the invoice 14/2026 for the Q1 project issued and sent to the client by Friday. Anna",
};
const SAMPLE_DELEGATES: ClassifierDelegate[] = [
  { id: "00000000-0000-4000-8000-000000000001", name: "Eva Accounting", tags: ["invoices"] },
  { id: "00000000-0000-4000-8000-000000000002", name: "Tom Sales", tags: ["offers"] },
];

async function main() {
  const config = loadConfig();
  const args = parseLlmCheckArgs(process.argv.slice(2));
  if (args === null) {
    log.error(usage);
    process.exit(1);
  }
  const table = llmRoleTable(config, { [args.role]: { provider: args.provider } });
  const row = table.roles[args.role];
  const keys = table.providers[row.provider];

  if (keys.apiKey === undefined) {
    log.error(`${keys.apiKeyName} is missing`);
    process.exit(1);
  }

  const llm = createLlmClient({ table });

  const line = (check: string, used: LlmUsage, extra = "") =>
    log.info(
      `role=${used.role} provider=${row.provider} model=${used.model} effort=${row.reasoningEffort ?? "-"} check=${check} latencyMs=${used.latencyMs} tokensIn=${used.tokensIn} tokensOut=${used.tokensOut}${extra}`
    );

  const greeting = await llm.generate(greetingCall(args.role));
  line("greeting", greeting.usage);

  if (args.role !== "classifier") return;

  const triage = await classifyEmail(llm, {
    email: SAMPLE_EMAIL,
    sender: { whitelisted: false, vip: false, noreply: false },
    allowed: classifierCategories,
    delegates: [],
  });
  line("triage", triage.usage, ` category=${triage.analysis.category}`);

  if (args.delegates) {
    const delegation = await classifyEmail(llm, {
      email: DELEGATE_EMAIL,
      sender: { whitelisted: false, vip: false, noreply: false },
      allowed: [...classifierCategories, "delegation"],
      delegates: SAMPLE_DELEGATES,
    });
    line(
      "delegates",
      delegation.usage,
      ` category=${delegation.analysis.category} delegatePicked=${delegation.analysis.fields.delegate_id !== null}`
    );
  }
}

main().catch((error) => {
  log.error(`check failed: ${describeError(error)}`);
  process.exit(1);
});
