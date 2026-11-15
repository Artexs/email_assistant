import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "bun:test";

import { checkSimCompose } from "./sim-compose-rules";

const FILE = resolve(import.meta.dir, "../../../../deploy/compose.sim.yaml");
const source = readFileSync(FILE, "utf8");

// A copy of the real file with one change inside one service block.
function change(service: string, from: string, to: string): string {
  const start = source.indexOf(`\n  ${service}:\n`);
  const at = source.indexOf(from, start);
  if (start < 0 || at < 0) throw new Error(`no "${from}" in ${service}`);
  return `${source.slice(0, at)}${to}${source.slice(at + from.length)}`;
}

const GUARDED_COMMANDS: [string, string][] = [
  ["server", "bun run lab:env-check && exec bun apps/server/src/main.ts"],
  ["lab", "bun run lab:env-check && exec bun run lab serve"],
  ["fake-telegram", "bun run lab:env-check && exec bun tools/fake-telegram/src/cli.ts serve --port 8090"],
];

describe("checkSimCompose", () => {
  test("the sim Compose file passes", () => {
    expect(checkSimCompose(Bun.YAML.parse(source))).toEqual([]);
  });

  test.each(GUARDED_COMMANDS)("a %s command without the env guard first is refused (review B6)", (service, command) => {
    const text = change(service, command, command.replace("bun run lab:env-check && ", ""));
    expect(checkSimCompose(Bun.YAML.parse(text))).toEqual([`${service}: command_without_env_guard`]);
  });

  test("a guard that is not first is refused", () => {
    const text = change("server", "bun run lab:env-check && exec", "echo hi && bun run lab:env-check && exec");
    expect(checkSimCompose(Bun.YAML.parse(text))).toEqual(["server: command_without_env_guard"]);
  });

  test("a service without mem_limit, a port without 127.0.0.1, or an env_file other than sim.env is refused", () => {
    expect(checkSimCompose(Bun.YAML.parse(change("server", "    mem_limit: 512m\n", "")))).toEqual([
      "server: no_mem_limit",
    ]);
    expect(checkSimCompose(Bun.YAML.parse(change("fake-telegram", '"127.0.0.1:8180:8080"', '"8180:8080"')))).toEqual([
      "fake-telegram: port_not_loopback",
    ]);
    expect(checkSimCompose(Bun.YAML.parse(change("server", "env_file: sim.env", "env_file: ../.env")))).toEqual([
      "server: env_file_not_sim_env",
    ]);
    expect(
      checkSimCompose(Bun.YAML.parse(change("lab", "env_file: sim.env", 'env_file: ["sim.env", "../.env"]')))
    ).toEqual(["lab: env_file_not_sim_env"]);
  });

  test("server and lab must share the network of fake-telegram; fake-telegram must not join another", () => {
    expect(
      checkSimCompose(Bun.YAML.parse(change("server", "network_mode: service:fake-telegram", "network_mode: bridge")))
    ).toEqual(["server: network_mode_not_fake_telegram"]);
    expect(checkSimCompose(Bun.YAML.parse(change("lab", "    network_mode: service:fake-telegram\n", "")))).toEqual([
      "lab: network_mode_not_fake_telegram",
    ]);
    expect(
      checkSimCompose(
        Bun.YAML.parse(
          change(
            "fake-telegram",
            "    restart: unless-stopped\n",
            "    restart: unless-stopped\n    network_mode: host\n"
          )
        )
      )
    ).toEqual(["fake-telegram: network_mode_not_fake_telegram"]);
  });

  test("the production image tag is refused, as a service image and as the base of the sim build (review N4)", () => {
    expect(checkSimCompose(Bun.YAML.parse(change("server", "image: ea-sim-server", "image: ea-server")))).toEqual([
      "server: production_image_tag",
    ]);
    const base = source.replace("${EA_SERVER_IMAGE:-ea-sim-base}", "${EA_SERVER_IMAGE:-ea-server}");
    expect(checkSimCompose(Bun.YAML.parse(base))).toContain("server: production_base_tag");
  });
});
