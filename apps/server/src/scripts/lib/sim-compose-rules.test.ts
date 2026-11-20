import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "bun:test";

import { checkSimCompose } from "./sim-compose-rules";

const FILE = resolve(import.meta.dir, "../../../../../deploy/compose.sim.yaml");
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
  ["lab", "bun run lab:env-check && exec bun apps/server/src/scripts/lab.ts serve"],
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

  test("greenmail must share the network of fake-telegram (the lab mailbox host is 127.0.0.1) and publish no port", () => {
    expect(
      checkSimCompose(Bun.YAML.parse(change("greenmail", "    network_mode: service:fake-telegram\n", "")))
    ).toEqual(["greenmail: network_mode_not_fake_telegram"]);
    expect(
      checkSimCompose(
        Bun.YAML.parse(
          change(
            "greenmail",
            "    mem_limit: 384m\n",
            '    mem_limit: 384m\n    ports:\n      - "127.0.0.1:3143:3143"\n'
          )
        )
      )
    ).toEqual(["greenmail: greenmail_port_published"]);
    // Both loopback and public: still refused.
    expect(
      checkSimCompose(
        Bun.YAML.parse(
          change("greenmail", "    mem_limit: 384m\n", '    mem_limit: 384m\n    ports:\n      - "3143:3143"\n')
        )
      )
    ).toEqual(["greenmail: port_not_loopback", "greenmail: greenmail_port_published"]);
  });

  // The false passes of an earlier review: forms of Compose that the first rules did not see.
  test("v3 an image under any tag of the production image is refused", () => {
    for (const image of ["ea-server:latest", "ea-server", "docker.io/library/ea-server:1"]) {
      const text = change("server", "image: ea-sim-server", `image: ${image}`);
      expect(checkSimCompose(Bun.YAML.parse(text))).toEqual(["server: production_image_tag"]);
    }
    const text = change("server", "image: ea-sim-server", "image: ea-server-sim");
    expect(checkSimCompose(Bun.YAML.parse(text))).toEqual([]);
  });

  test("v3b the production image as the default of the base build arg is refused, under any tag", () => {
    const base = source.replace("${EA_SERVER_IMAGE:-ea-sim-base}", "${EA_SERVER_IMAGE:-ea-server:latest}");
    expect(checkSimCompose(Bun.YAML.parse(base))).toContain("server: production_base_tag");
  });

  test("v4 an entrypoint, which would skip the env guard in the command, is refused", () => {
    const text = change(
      "server",
      "    restart: unless-stopped\n",
      "    restart: unless-stopped\n    entrypoint: [bun, apps/server/src/main.ts]\n"
    );
    expect(checkSimCompose(Bun.YAML.parse(text))).toEqual(["server: entrypoint_set"]);
  });

  test("v5 a service on another network, and an external network, are refused", () => {
    const joined = change("db", "    restart: unless-stopped\n", "    restart: unless-stopped\n    networks: [prod]\n");
    const text = joined.replace(
      "networks:\n  default:\n",
      "networks:\n  prod:\n    external: true\n    name: email-assistant_default\n  default:\n"
    );
    expect(checkSimCompose(Bun.YAML.parse(text)).sort()).toEqual([
      "db: network_not_default",
      "project: external_network",
    ]);
  });

  test("v5b an external volume is refused", () => {
    const text = source.replace(
      "  lab-state: {}",
      "  lab-state:\n    external: true\n    name: email-assistant_db-data"
    );
    expect(checkSimCompose(Bun.YAML.parse(text))).toEqual(["project: external_volume"]);
  });

  test("v6 extends is refused", () => {
    const text = change(
      "db",
      "    restart: unless-stopped\n",
      "    restart: unless-stopped\n    extends:\n      file: compose.yaml\n      service: server\n"
    );
    expect(checkSimCompose(Bun.YAML.parse(text))).toEqual(["db: extends_used"]);
  });

  test("v7 ports given as a string are refused", () => {
    const text = change("fake-telegram", '    ports:\n      - "127.0.0.1:8180:8080"\n', '    ports: "8180:8080"\n');
    expect(checkSimCompose(Bun.YAML.parse(text))).toEqual(["fake-telegram: ports_not_list"]);
  });

  test("v9 a bind mount of ../.env, or any source outside the two sim paths, is refused", () => {
    for (const volume of ["../.env:/app/.env:ro", "/var/run/docker.sock:/s", "../deploy/sim.env:/e"]) {
      const text = change("db", "    volumes:\n", `    volumes:\n      - ${volume}\n`);
      expect(checkSimCompose(Bun.YAML.parse(text))).toEqual(["db: bind_mount_not_allowed"]);
    }
    const long = change(
      "db",
      "    volumes:\n",
      "    volumes:\n      - type: bind\n        source: ../.env\n        target: /app/.env\n"
    );
    expect(checkSimCompose(Bun.YAML.parse(long))).toEqual(["db: bind_mount_not_allowed"]);
  });
});
