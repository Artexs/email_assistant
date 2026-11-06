import { afterEach, describe, expect, test } from "bun:test";
import { GrammyError, HttpError } from "grammy";

import { checkBot } from "./check";
import { telegramErrorLabel } from "./errors";

const token = "123456:MARKERTOKENaaaaaaaaaaaaaaaaaaaaaaaaaa";

type FakeServer = ReturnType<typeof Bun.serve>;
const servers: FakeServer[] = [];

function startFake(answer: unknown): { server: FakeServer; paths: string[] } {
  const paths: string[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      paths.push(new URL(req.url).pathname);
      return Response.json(answer);
    },
  });
  servers.push(server);
  return { server, paths };
}

afterEach(() => {
  for (const server of servers.splice(0)) {
    void server.stop(true);
  }
});

describe("checkBot", () => {
  test("returns the id and the user name", async () => {
    const { server, paths } = startFake({
      ok: true,
      result: { id: 7, is_bot: true, first_name: "b", username: "probe_bot", can_join_groups: false },
    });
    const bot = await checkBot(token, { apiRoot: `http://127.0.0.1:${server.port}` });
    expect(bot).toEqual({ id: 7, username: "probe_bot" });
    expect(paths).toEqual([`/bot${token}/getMe`]);
  });

  test("a rejected token gives a GrammyError with a label", async () => {
    const { server } = startFake({ ok: false, error_code: 401, description: "Unauthorized" });
    const error = await checkBot(token, { apiRoot: `http://127.0.0.1:${server.port}` }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GrammyError);
    expect(telegramErrorLabel(error)).toBe("GrammyError getMe 401");
  });

  test("a closed port gives an HttpError whose label has no token", async () => {
    const closed = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("") });
    const port = closed.port;
    await closed.stop(true);
    const error = await checkBot(token, { apiRoot: `http://127.0.0.1:${port}` }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect(telegramErrorLabel(error)).toBe("HttpError getMe");
    expect(telegramErrorLabel(error)).not.toContain("MARKERTOKEN");
  });
});

describe("telegramErrorLabel", () => {
  test("other errors give only the name", () => {
    expect(telegramErrorLabel(new Error(`failed for ${token}`))).toBe("Error");
    expect(telegramErrorLabel("x")).toBe("string");
  });
});
