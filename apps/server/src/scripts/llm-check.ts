import { classifierCategories, EXIT, llmRoles } from "@ea/core";

import { type ClassifierDelegate, type ClassifierEmail, classifyEmail } from "../modules/triage";
import { type CliOutput, exitCodeOf, runCli } from "../platform/cli";
import {
  type Config,
  ConfigError,
  llmRoleTable,
  loadConfig,
  runFlagError,
  runFlagExitCode,
  runOverrides,
} from "../platform/config";
import { describeError } from "../platform/errors";
import { createLlmClient, llmEndpointFields, type LlmUsage, type ProviderRegistry } from "../platform/llm";

import { cliDescriptions, greetingCall, type LlmCheckArgs, parseLlmCheckArgs, usage } from "./llm-check-args";

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

export interface LlmCheckDeps {
  config: Config;
  args: LlmCheckArgs;
  /** Tests: fake providers, passed to `createLlmClient`. */
  providers?: Partial<ProviderRegistry>;
  out: CliOutput;
}

// The checks of one run. Returns the exit code: 0 all calls answered, 1 a missing key or a failed call, 2 a flag the provider
// does not take, 3 the provider did not answer (timeout, 429, 503).
// Every key is checked before the first call. A line holds no key and no model text.
export async function runLlmCheck(deps: LlmCheckDeps): Promise<number> {
  const { config, args, out } = deps;
  try {
    const roles = args.role === "all" ? llmRoles : [args.role];
    let table;
    try {
      table = llmRoleTable(config, runOverrides("classifier", { provider: args.provider }));
    } catch (error) {
      if (!(error instanceof ConfigError)) throw error;
      out.fail(runFlagError(error));
      out.fail(`usage: ${usage}`);
      return runFlagExitCode(error);
    }

    const missing = [...new Set(roles.map((role) => table.providers[table.roles[role].provider]))].filter(
      (keys) => keys.apiKey === undefined
    );
    if (missing.length > 0) {
      for (const keys of missing) out.fail(`${keys.apiKeyName} is missing`);
      return 1;
    }

    const llm = createLlmClient({ table, providers: deps.providers });
    const line = (check: string, used: LlmUsage, extra = "") => {
      const row = table.roles[used.role];
      const where = llmEndpointFields(table, used.role);
      out.print(
        `role=${used.role} provider=${row.provider} model=${used.model} endpoint=${used.endpoint} host=${where.host ?? "-"} effort=${row.reasoningEffort ?? "-"} check=${check} latencyMs=${used.latencyMs} tokensIn=${used.tokensIn} tokensOut=${used.tokensOut}${extra}`
      );
    };

    for (const role of roles) {
      const greeting = await llm.generate(greetingCall(role));
      line("greeting", greeting.usage);
      if (role !== "classifier") continue;

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
    return 0;
  } catch (error) {
    const code = exitCodeOf(error);
    out.fail(`${code === EXIT.unreachable ? "unreachable" : "check failed"}: ${describeError(error)}`);
    return code;
  }
}

async function main(argv: string[], out: CliOutput): Promise<number> {
  const args = parseLlmCheckArgs(argv);
  let config: Config;
  try {
    config = loadConfig();
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    out.fail(`config error: ${error.keys.join(", ")}`);
    return 1;
  }
  return runLlmCheck({ config, args, out });
}

// `import.meta.main`: a test imports `runLlmCheck` without running the script.
if (import.meta.main) {
  await runCli({ prefix: "llm-check", descriptions: cliDescriptions, main });
}
