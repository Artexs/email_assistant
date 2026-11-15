import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import { startFakeTelegram, type FakeTelegram } from "./server";

// The sim stack (deploy/compose.sim.yaml) waits for the healthcheck of fake-telegram. A path that the fake does not serve
// keeps the service unhealthy and the server never starts (F113 stage 03 review B1). The test reads the URL from the Compose file.
const COMPOSE = resolve(import.meta.dir, "../../../deploy/compose.sim.yaml");

interface Compose {
  services: Record<string, { healthcheck?: { test?: string[] }; command?: string[] }>;
}

function composeHealthUrl(): URL {
  const doc = Bun.YAML.parse(readFileSync(COMPOSE, "utf8")) as Compose;
  const script = (doc.services["fake-telegram"]?.healthcheck?.test ?? []).join(" ");
  const found = /fetch\('([^']+)'\)/.exec(script);
  if (found?.[1] === undefined) throw new Error("no fetch URL in the fake-telegram healthcheck");
  return new URL(found[1]);
}

describe("fake-telegram healthcheck of the sim Compose file", () => {
  let fake: FakeTelegram | undefined;
  afterEach(async () => {
    await fake?.stop();
    fake = undefined;
  });

  test("the URL points at loopback and at the port of `serve --port`", () => {
    const doc = Bun.YAML.parse(readFileSync(COMPOSE, "utf8")) as Compose;
    const command = (doc.services["fake-telegram"]?.command ?? []).join(" ");
    const url = composeHealthUrl();
    expect(url.hostname).toBe("127.0.0.1");
    expect(command).toContain(`serve --port ${url.port}`);
  });

  test("the path of the healthcheck is served by the fake: 200", async () => {
    fake = startFakeTelegram({});
    const url = composeHealthUrl();
    const response = await fetch(`${fake.apiRoot}${url.pathname}`);
    expect(response.status).toBe(200);
  });
});
