import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { failureCodes } from "./mail";
import { ENDPOINTS, randomToken, REDIRECT_PORT, startCallbackServer, type Endpoints, type Provider } from "./oauth";
import { assertSafeEvidence, EvidenceRefusal, maskAddresses } from "./redact";
import { newCtx, rowsFor, type Deps, type Row, type SpikeEnv, type Verdict } from "./rows";
import { closeSession, type Answer } from "./rows-core";

// Probe CLI. Usage: bun tools/mail-oauth-spike/probe.ts <microsoft|microsoft-personal|google> --out <file>
// The owner runs it on the owner's machine with the real accounts (README.md). The file holds no secret and no address.

export const PROVIDER_NAMES: readonly Provider[] = ["microsoft", "microsoft-personal", "google"];

export interface ResultRow {
  id: string;
  verdict: Verdict;
  evidence: string;
}

export interface ProbeOptions {
  provider: Provider;
  out: string;
  env: SpikeEnv;
  deps: Deps;
  endpoints?: Endpoints;
  /** Tests give their own rows. */
  rows?: Row[];
}

/**
 * Run the rows in order. Every evidence string passes the guard before it is shown or kept. One refused string means no
 * result file and exit code 1: a partial file with a leak is worse than no file.
 */
export async function runProbe(options: ProbeOptions): Promise<number> {
  const { provider, deps } = options;
  const ctx = newCtx(provider, options.env, deps, options.endpoints ?? ENDPOINTS[provider]);
  const known = [options.env.ownerAddress];
  const rows: ResultRow[] = [];
  const refused: { id: string; rule: string }[] = [];
  try {
    for (const row of options.rows ?? rowsFor(provider)) {
      let outcome: { verdict: Verdict; evidence: string };
      try {
        outcome = await row.run(ctx);
      } catch (error) {
        outcome = { verdict: "FAIL", evidence: `row stopped: ${failureCodes(error)}` };
      }
      if (ctx.state.login !== undefined) known.push(ctx.state.login);
      const evidence = typeof outcome.evidence === "string" ? maskAddresses(outcome.evidence, known) : outcome.evidence;
      try {
        assertSafeEvidence(evidence);
      } catch (error) {
        const rule = error instanceof EvidenceRefusal ? error.rule : "unknown";
        refused.push({ id: row.id, rule });
        deps.say(`${row.id} REFUSED: evidence withheld by rule ${rule}`);
        continue;
      }
      rows.push({ id: row.id, verdict: outcome.verdict, evidence });
      deps.say(`${row.id} ${outcome.verdict}: ${evidence}`);
    }
  } finally {
    await closeSession(ctx);
  }
  if (refused.length > 0) {
    deps.say(`No result file written: ${refused.map((item) => `${item.id} (${item.rule})`).join(", ")}.`);
    return 1;
  }
  const result = { provider, ranAt: new Date(deps.now()).toISOString(), rows };
  await mkdir(dirname(options.out), { recursive: true });
  await Bun.write(options.out, `${JSON.stringify(result, null, 2)}\n`);
  deps.say(`Result file written: ${options.out}`);
  return 0;
}

export function parseArgs(argv: string[]): { provider: Provider; out: string } | { error: string } {
  const [provider, flag, out, ...rest] = argv;
  if (provider === undefined || !PROVIDER_NAMES.includes(provider as Provider)) {
    return { error: `The first argument must be one of: ${PROVIDER_NAMES.join(", ")}.` };
  }
  if (flag !== "--out" || out === undefined || out.length === 0 || rest.length > 0) {
    return { error: "Usage: bun tools/mail-oauth-spike/probe.ts <provider> --out <file>" };
  }
  return { provider: provider as Provider, out };
}

/** Reads the owner's shell. The error names the missing variables, never a value. */
export function readEnv(provider: Provider, env: Record<string, string | undefined>): SpikeEnv | { error: string } {
  const prefix = provider === "google" ? "SPIKE_GOOGLE" : "SPIKE_MS";
  const secretRequired = provider === "google";
  const missing = [
    `${prefix}_CLIENT_ID`,
    ...(secretRequired ? [`${prefix}_CLIENT_SECRET`] : []),
    "SPIKE_OWNER_ADDRESS",
  ].filter((name) => (env[name] ?? "") === "");
  if (missing.length > 0) return { error: `Set these environment variables first: ${missing.join(", ")}.` };
  const ownerAddress = env["SPIKE_OWNER_ADDRESS"] ?? "";
  if (!/^[^\s@]+@[^\s@]+$/.test(ownerAddress)) return { error: "SPIKE_OWNER_ADDRESS must be one mail address." };
  const secret = env[`${prefix}_CLIENT_SECRET`];
  return {
    clientId: env[`${prefix}_CLIENT_ID`] ?? "",
    ...(secret === undefined || secret === "" ? {} : { clientSecret: secret }),
    ownerAddress,
  };
}

function parseAnswer(line: string | null): Answer | undefined {
  const value = (line ?? "").trim().toLowerCase();
  if (value === "y" || value === "yes") return "y";
  if (value === "n" || value === "no") return "n";
  if (value === "" || value === "s" || value === "skip") return "skip";
  return undefined;
}

function hiddenPrompt(question: string): Promise<string | null> {
  if (!process.stdin.isTTY) return Promise.resolve(null);
  process.stderr.write(question);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve) => {
    let typed = "";
    const finish = (value: string | null): void => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stderr.write("\n");
      resolve(value);
    };
    const onData = (chunk: Buffer): void => {
      for (const char of chunk.toString("utf8")) {
        if (char === "\r" || char === "\n") return finish(typed);
        if (char === "\u0003") return finish(null);
        typed = char === "\u007f" ? typed.slice(0, -1) : `${typed}${char}`;
      }
    };
    process.stdin.on("data", onData);
  });
}

export function realDeps(): Deps {
  return {
    fetch,
    async ask(question) {
      for (;;) {
        const answer = parseAnswer(prompt(`\n${question}\n> `));
        if (answer !== undefined) return answer;
        process.stderr.write("Type y, n or skip.\n");
      }
    },
    askSecret: hiddenPrompt,
    say: (line) => process.stderr.write(`${line}\n`),
    async browse(buildUrl) {
      const state = randomToken(32);
      const server = startCallbackServer({ port: REDIRECT_PORT, state, timeoutMs: 10 * 60_000 });
      process.stderr.write(
        `\nOpen this URL in your browser and sign in:\n${buildUrl(state)}\n\nWaiting for the redirect...\n`
      );
      try {
        return await server.result;
      } finally {
        server.stop();
      }
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
  };
}

export async function main(argv: string[], env: Record<string, string | undefined>): Promise<number> {
  const args = parseArgs(argv);
  if ("error" in args) {
    process.stderr.write(`${args.error}\n`);
    return 2;
  }
  const spikeEnv = readEnv(args.provider, env);
  if ("error" in spikeEnv) {
    process.stderr.write(`${spikeEnv.error}\n`);
    return 2;
  }
  return await runProbe({ provider: args.provider, out: args.out, env: spikeEnv, deps: realDeps() });
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2), process.env));
}
