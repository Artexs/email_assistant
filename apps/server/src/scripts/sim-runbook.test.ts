import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "bun:test";

import { usage } from "./lab-args";

// The sim runbook (`deploy/README.md` § Sim stack) is run by an operator who has no chat history. This test
// checks that every script, lab command, flag, file, service and env key that the runbook names exists. It reads files only:
// it calls no docker or compose command, needs no `.env` and does not depend on the version of Compose.
const REPO = resolve(import.meta.dir, "../../../..");
const HEADING = "## Sim stack (`ea-sim`)";
const WORD = /^[a-z][a-z-]*$/;

function readRepo(path: string): string {
  return readFileSync(resolve(REPO, path), "utf8");
}

function runbook(): string {
  const readme = readRepo("deploy/README.md");
  const start = readme.indexOf(`\n${HEADING}\n`);
  if (start === -1) throw new Error("the Sim stack section is missing");
  const rest = readme.slice(start + HEADING.length + 2);
  const next = rest.search(/\n## /);
  return next === -1 ? rest : rest.slice(0, next);
}

/** Every inline code span and every line of a fenced block: the places where a command can stand. */
function codeSnippets(markdown: string): string[] {
  const snippets: string[] = [];
  let fenced = false;
  for (const line of markdown.split("\n")) {
    if (line.trim().startsWith("```")) {
      fenced = !fenced;
      continue;
    }
    if (fenced) {
      snippets.push(line.trim());
      continue;
    }
    for (const match of line.matchAll(/`([^`\n]+)`/g)) snippets.push(match[1] ?? "");
  }
  return snippets;
}

/** The lab commands in a snippet: the command word and the flags up to the next command or the end. */
function labCommands(snippet: string): { command: string; flags: string[] }[] {
  return snippet
    .split(/(?=\$L |bun run lab )/)
    .map((part) => /^(?:\$L|bun run lab) ([a-z-]+)(.*)$/.exec(part))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({
      command: match[1] ?? "",
      flags: [...(match[2] ?? "").matchAll(/(?<![\w-])--[a-z-]+/g)].map((flag) => flag[0]),
    }));
}

/** The service names that a `$S` command addresses, by verb. */
function composeServices(snippet: string): string[] {
  const found: string[] = [];
  for (const part of snippet.split(/(?=\$S )/)) {
    if (!part.startsWith("$S ")) continue;
    const words = part
      .slice(3)
      .split(/\s+/)
      .map((word) => word.replace(/^["'(]+|["')]+$/g, ""))
      .filter(Boolean);
    const verb = words[0];
    const plain = words.slice(1).filter((word) => WORD.test(word));
    if (verb === "exec") found.push(plain[0] ?? "");
    if (verb === "restart") found.push(...plain);
    if (verb === "ps") found.push(...plain);
    if (verb === "up" && words.includes("--force-recreate")) {
      found.push(...words.slice(words.indexOf("--force-recreate") + 1).filter((word) => WORD.test(word)));
    }
    if (verb === "cp") found.push(...words.flatMap((word) => /^([a-z][a-z-]*):\//.exec(word)?.[1] ?? []));
    if (verb === "logs") found.push(words.at(-1) ?? "");
  }
  return found;
}

const section = runbook();
const snippets = codeSnippets(section);

const usageByCommand = new Map(
  usage
    .split("\n")
    .map((line) => /^ *bun run lab (.+)$/.exec(line)?.[1])
    .filter((line): line is string => line !== undefined)
    .map((line) => [line.split(" ")[0] ?? "", line])
);
const compose = Bun.YAML.parse(readRepo("deploy/compose.sim.yaml")) as { services: Record<string, unknown> };
const services = new Set(Object.keys(compose.services));
const scripts = new Set(Object.keys((JSON.parse(readRepo("package.json")) as { scripts: object }).scripts));
const envKeys = new Set(
  readRepo("deploy/sim.env.example")
    .split("\n")
    .map((line) => /^([A-Z][A-Z0-9_]*)=/.exec(line)?.[1])
    .filter((key): key is string => key !== undefined)
);

describe("the helpers", () => {
  test("labCommands reads the command and its flags", () => {
    expect(labCommands("$L reset --org lab --yes, then $L stop --run <id>")).toEqual([
      { command: "reset", flags: ["--org", "--yes"] },
      { command: "stop", flags: ["--run"] },
    ]);
  });

  test("composeServices reads the service of each verb", () => {
    expect(composeServices("$S exec -T lab bun run lab status")).toEqual(["lab"]);
    expect(composeServices("$S up -d --force-recreate greenmail server lab")).toEqual(["greenmail", "server", "lab"]);
    expect(composeServices("$S cp lab:/var/lib/x /tmp/x")).toEqual(["lab"]);
    expect(composeServices("$S logs --no-log-prefix --since 5m server")).toEqual(["server"]);
    expect(composeServices('"$($S ps -q fake-telegram)"')).toEqual(["fake-telegram"]);
  });
});

describe("deploy/README.md § Sim stack", () => {
  test("the section holds the runbook steps in order", () => {
    const steps = [...section.matchAll(/^(\d+)\. \*\*([^*]+)\*\*/gm)].map((match) => `${match[1]} ${match[2]}`);
    expect(steps).toEqual([
      "1 Release.",
      "2 Disk.",
      "3 Backup first.",
      "4 Build.",
      "5 Env.",
      "6 Start and migrate.",
      "7 Panel.",
      "8 Seed.",
      "9 Checks",
      "10 Run.",
      "11 Score.",
      "12 Demo.",
      "13 Restart order.",
      "14 Stop and roll back.",
    ]);
  });

  test("S is the Compose line of the sim:up and sim:down scripts", () => {
    const prefix = /^S="(.+)"$/m.exec(section)?.[1];
    expect(prefix).toBeDefined();
    const packageJson = readRepo("package.json");
    expect(packageJson).toContain(`"sim:up": "${prefix} up -d --wait"`);
    expect(packageJson).toContain(`"sim:down": "${prefix} down"`);
    expect(section).toContain('L="$S exec -T lab bun run lab"');
  });

  test("every `bun run` script exists", () => {
    const names = [...section.matchAll(/bun run ([a-z0-9][a-z0-9:_-]*)/g)].map((match) => match[1] ?? "");
    expect(names.length).toBeGreaterThan(5);
    expect(names.filter((name) => !scripts.has(name))).toEqual([]);
  });

  test("every lab command and flag is in the usage of `bun run lab`", () => {
    const commands = snippets.flatMap(labCommands);
    expect(new Set(commands.map((entry) => entry.command))).toEqual(
      new Set(["seed", "start", "status", "stop", "score", "reset", "demo-reset", "demo-export", "demo-import"])
    );
    for (const { command, flags } of commands) {
      const line = usageByCommand.get(command);
      expect({ command, known: line !== undefined }).toEqual({ command, known: true });
      for (const flag of flags) {
        expect({ command, flag, inUsage: line?.includes(flag) }).toEqual({ command, flag, inUsage: true });
      }
    }
  });

  test("every compose service it names is in the sim Compose file", () => {
    const named = snippets.flatMap(composeServices);
    expect(named.length).toBeGreaterThan(8);
    expect(named.filter((name) => !services.has(name))).toEqual([]);
  });

  test("every repo path it names exists", () => {
    // Not in git on purpose: the env file of the stack and the state file of the release script.
    const local = new Set(["deploy/sim.env", "deploy/release-state/state"]);
    const paths = snippets
      .flatMap((snippet) => snippet.split(/\s+/))
      .map((word) => word.replace(/^["'(]+|["'),.:;]+$/g, "").replace(/#.*$/, ""))
      .filter((word) => /^(deploy|docs|apps|packages|evals|tools)\//.test(word) && !/[<*{$]/.test(word));
    expect(paths.length).toBeGreaterThan(8);
    expect(paths.filter((path) => !local.has(path) && !existsSync(resolve(REPO, path)))).toEqual([]);
  });

  test("the env keys that the commands set are in sim.env.example", () => {
    const keys = [...section.matchAll(/for key in ([A-Z_ ]+);/g)].flatMap((match) => (match[1] ?? "").split(" "));
    expect(keys).toEqual([
      "CREDENTIALS_KEY",
      "WEB_AUTH_SECRET",
      "POSTGRES_PASSWORD",
      "MIGRATOR_PASSWORD",
      "APP_PASSWORD",
    ]);
    for (const key of [...keys, "EA_SERVER_IMAGE", "WEB_BASE_URL"]) {
      expect({ key, has: envKeys.has(key) }).toEqual({ key, has: true });
    }
    expect(readRepo("deploy/sim.env.example")).toContain("https://<host>:8443");
    expect(section).toContain("s|<host>|");
  });

  test("a sim deploy is a release", () => {
    expect(section).toContain("Every deploy of the sim stack is a release");
    expect(section).toContain("deploy/release.sh");
    expect(section).toContain("docs/release-checklist.md");
    expect(section).toContain("git describe --tags --exact-match");
    expect(section).toContain('--build-arg EA_RELEASE="$T" -t "ea-sim-base:$T"');
    expect(section).toContain("EA_SERVER_IMAGE=ea-sim-base:$T");
    // The production tag stays out of every build and tag command.
    for (const snippet of snippets.filter((entry) => /docker (build|tag)/.test(entry))) {
      expect({ snippet, production: /ea-server/.test(snippet) }).toEqual({ snippet, production: false });
    }
  });

  test("no command prints a secret", () => {
    const printing = snippets.filter((snippet) =>
      /(^|[;&|] *)(cat|less|more|head|tail|printenv|echo) .*(\.env|KEY|SECRET|PASSWORD)|\$S config(?! --quiet)/.test(
        snippet
      )
    );
    // The rule sentence "Never run `$S config`" is the one allowed mention.
    expect(printing).toEqual(["$S config"]);
    expect(section).toContain("Never run `$S config`");
    for (const snippet of snippets.filter((entry) => entry.startsWith("grep") && entry.includes(".env"))) {
      expect({ snippet, appends: snippet.includes(">> deploy/sim.env") }).toEqual({ snippet, appends: true });
    }
  });

  test("it keeps the guard rules and the panel port", () => {
    expect(section).toContain("Never set `SEND_SCOPE=all` or a real bot token");
    expect(section).toContain("Never point the sim at the production `.env`");
    expect(section).toContain("--https=8443 http://127.0.0.1:8180");
  });
});
