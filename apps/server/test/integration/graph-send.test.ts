import { createServer, type Server, type Socket } from "node:net";
import { format, inspect } from "node:util";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test";

import {
  GRAPH_MAX_RAW_BYTES,
  MailAuthError,
  openGraphSender,
  SmtpSendError,
  type MailSender,
} from "../../src/modules/mail";
import { SoftError } from "../../src/platform/errors";
import { logFormatFromEnv, setLogFormat, setLogLevel } from "../../src/platform/log";
import { runMailSenderContract } from "../contract/mail-sender";
import { startFakeGraph, type FakeGraph } from "../fake-graph";

// F117 stage 13: the Graph sender against the fake Graph server. No real Microsoft call, no real address (test addresses end in `@x.test`).
const FROM = "a@x.test";
const TOKEN = "graph-access-token-canary-1";
const FRESH = "graph-access-token-canary-2";

let graph: FakeGraph;
let freshCalls = 0;
const opened: MailSender[] = [];

beforeAll(async () => {
  graph = await startFakeGraph();
});

afterAll(async () => {
  await graph.stop();
});

beforeEach(() => {
  graph.calls.length = 0;
  graph.sent.length = 0;
  freshCalls = 0;
});

afterEach(async () => {
  for (const sender of opened.splice(0)) await sender.close().catch(() => undefined);
});

async function open(over: { freshToken?: () => Promise<string>; timeoutMs?: number; baseUrl?: string } = {}) {
  const sender = await openGraphSender({
    accessToken: TOKEN,
    from: FROM,
    freshToken:
      over.freshToken ??
      (async () => {
        freshCalls += 1;
        return FRESH;
      }),
    baseUrl: over.baseUrl ?? graph.baseUrl,
    ...(over.timeoutMs === undefined ? {} : { timeoutMs: over.timeoutMs }),
  });
  opened.push(sender);
  return sender;
}

function rawOf(headers: string[], body = "Hello.\r\n"): Buffer {
  return Buffer.from(
    [
      "Message-ID: <graph-test@ea.test>",
      "X-EA-Action-Id: 00000000-0000-4000-8000-000000000001",
      `From: ${FROM}`,
      ...headers,
      "Subject: graph test",
      "Date: Sat, 14 Nov 2026 10:00:00 +0000",
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "",
      body,
    ].join("\r\n")
  );
}

const simple = (to: string[]) => ({ envelope: { from: FROM, to }, raw: rawOf([`To: ${to.join(", ")}`]) });

async function failureOf(run: Promise<unknown>): Promise<unknown> {
  return run.then(
    () => {
      throw new Error("the send did not fail");
    },
    (error: unknown) => error
  );
}

runMailSenderContract("graph-fake", async () => ({
  open: ({ from }) =>
    openGraphSender({
      accessToken: TOKEN,
      from,
      freshToken: async () => FRESH,
      baseUrl: graph.baseUrl,
    }),
  async received(messageId) {
    return graph.sent.find((call) => call.raw.includes(messageId))?.raw ?? null;
  },
  // The fake answers 401 twice: the first token and the fresh one are both refused.
  async openRefused({ from }) {
    graph.respondNext(401, { error: { code: "InvalidAuthenticationToken" } });
    graph.respondNext(401, { error: { code: "InvalidAuthenticationToken" } });
    return openGraphSender({
      accessToken: TOKEN,
      from,
      freshToken: async () => FRESH,
      baseUrl: graph.baseUrl,
    });
  },
}));

describe("the call", () => {
  test("a send is one POST with the bearer token, text/plain and the base64 of the raw mail", async () => {
    const sender = await open();
    const input = simple(["b@x.test"]);
    const result = await sender.send(input);
    expect(result).toEqual({ response: "202 Accepted", accepted: ["b@x.test"], rejected: [] });
    expect(graph.calls).toHaveLength(1);
    expect(graph.calls[0]?.authorization).toBe(`Bearer ${TOKEN}`);
    expect(graph.calls[0]?.raw.equals(input.raw)).toBe(true);
  });
});

describe("the envelope check (a Graph mail goes to the recipients of its MIME)", () => {
  test("2a. a Bcc recipient of the MIME that the envelope lists: one call", async () => {
    const sender = await open();
    const raw = rawOf(["To: b@x.test", "Bcc: c@x.test"]);
    const result = await sender.send({ envelope: { from: FROM, to: ["b@x.test", "c@x.test"] }, raw });
    expect(result.accepted).toEqual(["b@x.test", "c@x.test"]);
    expect(graph.calls).toHaveLength(1);
  });

  test("2b. the envelope lacks the Bcc recipient: envelope error, permanent, no call", async () => {
    const sender = await open();
    const raw = rawOf(["To: b@x.test", "Bcc: c@x.test"]);
    const error = await failureOf(sender.send({ envelope: { from: FROM, to: ["b@x.test"] }, raw }));
    expect(error).toBeInstanceOf(SmtpSendError);
    expect(error).toMatchObject({ stage: "envelope", permanent: true, soft: false });
    expect(graph.calls).toHaveLength(0);
  });

  test("2c. the envelope lists an address that the MIME lacks: no call", async () => {
    const sender = await open();
    const error = await failureOf(
      sender.send({ envelope: { from: FROM, to: ["b@x.test", "d@x.test"] }, raw: rawOf(["To: b@x.test"]) })
    );
    expect(error).toMatchObject({ stage: "envelope", permanent: true });
    expect(graph.calls).toHaveLength(0);
  });

  test("2d. Cc counts, the case of an address does not, a display name does not", async () => {
    const sender = await open();
    const raw = rawOf(['To: "Bea B" <B@X.test>', "Cc: c@x.test"]);
    await sender.send({ envelope: { from: FROM, to: ["b@x.test", "C@x.test"] }, raw });
    expect(graph.calls).toHaveLength(1);
  });

  test("2e. a MIME without any recipient header: no call", async () => {
    const sender = await open();
    const error = await failureOf(sender.send({ envelope: { from: FROM, to: ["b@x.test"] }, raw: rawOf([]) }));
    expect(error).toMatchObject({ stage: "envelope" });
    expect(graph.calls).toHaveLength(0);
  });

  test("2f. a recipient in the body, not in a header, does not count", async () => {
    const sender = await open();
    const raw = rawOf(["To: b@x.test"], "To: c@x.test\r\n");
    const error = await failureOf(sender.send({ envelope: { from: FROM, to: ["b@x.test", "c@x.test"] }, raw }));
    expect(error).toMatchObject({ stage: "envelope" });
    expect(graph.calls).toHaveLength(0);
  });

  test("3. an envelope sender other than the mailbox address: no call; the case of the address does not matter", async () => {
    const sender = await open();
    const error = await failureOf(
      sender.send({ envelope: { from: "other@x.test", to: ["b@x.test"] }, raw: rawOf(["To: b@x.test"]) })
    );
    expect(error).toMatchObject({ stage: "envelope", permanent: true });
    expect(graph.calls).toHaveLength(0);
    await sender.send({ envelope: { from: "A@X.test", to: ["b@x.test"] }, raw: rawOf(["To: b@x.test"]) });
    expect(graph.calls).toHaveLength(1);
  });

  test("4. 3 MiB goes, 3 MiB + 1 byte is an envelope error with no call", async () => {
    const sender = await open();
    const head = rawOf(["To: b@x.test"], "");
    const padded = (size: number) => Buffer.concat([head, Buffer.alloc(size - head.length, "a")]);
    await sender.send({ envelope: { from: FROM, to: ["b@x.test"] }, raw: padded(GRAPH_MAX_RAW_BYTES) });
    expect(graph.calls).toHaveLength(1);
    const error = await failureOf(
      sender.send({ envelope: { from: FROM, to: ["b@x.test"] }, raw: padded(GRAPH_MAX_RAW_BYTES + 1) })
    );
    expect(error).toMatchObject({ stage: "envelope", permanent: true });
    expect(graph.calls).toHaveLength(1);
  });
});

describe("the answer map", () => {
  test("5a. 401 then 202: one fresh token, two calls, the second with the fresh token", async () => {
    const sender = await open();
    graph.respondNext(401, { error: { code: "InvalidAuthenticationToken" } });
    const result = await sender.send(simple(["b@x.test"]));
    expect(result.response).toBe("202 Accepted");
    expect(freshCalls).toBe(1);
    expect(graph.calls.map((call) => call.authorization)).toEqual([`Bearer ${TOKEN}`, `Bearer ${FRESH}`]);
    expect(graph.sent).toHaveLength(1);
  });

  test("5b. 401 twice: MailAuthError oauth_revoked, two calls, one fresh token", async () => {
    const sender = await open();
    graph.respondNext(401);
    graph.respondNext(401);
    const error = await failureOf(sender.send(simple(["b@x.test"])));
    expect(error).toBeInstanceOf(MailAuthError);
    expect((error as MailAuthError).reason).toBe("oauth_revoked");
    expect(graph.calls).toHaveLength(2);
    expect(freshCalls).toBe(1);
  });

  test("5c. a later send uses the fresh token; it asks for no second one", async () => {
    const sender = await open();
    graph.respondNext(401);
    await sender.send(simple(["b@x.test"]));
    await sender.send(simple(["b@x.test"]));
    expect(graph.calls.map((call) => call.authorization).at(-1)).toBe(`Bearer ${FRESH}`);
    expect(freshCalls).toBe(1);
  });

  test("5d. 401, then the token store refuses the refresh: its MailAuthError passes, one call", async () => {
    const sender = await open({
      freshToken: async () => {
        throw new MailAuthError("oauth grant refused", { reason: "oauth_expired" });
      },
    });
    graph.respondNext(401);
    const error = await failureOf(sender.send(simple(["b@x.test"])));
    expect(error).toBeInstanceOf(MailAuthError);
    expect((error as MailAuthError).reason).toBe("oauth_expired");
    expect(graph.calls).toHaveLength(1);
  });

  test("5e. 401, then the refresh has a soft fault: a soft connect error (not sent), a hard fault: connect, not soft", async () => {
    const soft = await open({
      freshToken: async () => {
        throw new SoftError("provider down");
      },
    });
    graph.respondNext(401);
    expect(await failureOf(soft.send(simple(["b@x.test"])))).toMatchObject({ stage: "connect", soft: true });
    const hard = await open({
      freshToken: async () => {
        throw new Error("boom");
      },
    });
    graph.respondNext(401);
    expect(await failureOf(hard.send(simple(["b@x.test"])))).toMatchObject({
      stage: "connect",
      soft: false,
      permanent: false,
    });
    expect(graph.calls).toHaveLength(2);
  });

  test("6a. 403 ErrorAccessDenied: MailAuthError admin_consent_required, no retry", async () => {
    const sender = await open();
    graph.respondNext(403, { error: { code: "ErrorAccessDenied", message: "Access is denied." } });
    const error = await failureOf(sender.send(simple(["b@x.test"])));
    expect(error).toBeInstanceOf(MailAuthError);
    expect((error as MailAuthError).reason).toBe("admin_consent_required");
    expect(graph.calls).toHaveLength(1);
  });

  test("6b. 403 MailboxNotEnabledForRESTAPI, another code, and a body that is not JSON: protocol_disabled", async () => {
    const sender = await open();
    for (const body of [{ error: { code: "MailboxNotEnabledForRESTAPI" } }, { nothing: true }, undefined]) {
      graph.respondNext(403, body);
      const error = await failureOf(sender.send(simple(["b@x.test"])));
      expect((error as MailAuthError).reason).toBe("protocol_disabled");
    }
  });

  test("6c. a refusal does not carry the Graph message in its text or its fields", async () => {
    const sender = await open();
    graph.respondNext(403, { error: { code: "ErrorAccessDenied", message: "user b@x.test is secret-detail" } });
    const error = await failureOf(sender.send(simple(["b@x.test"])));
    expect(inspect(error, { depth: 6 })).not.toContain("secret-detail");
  });

  test("7a. 400, 404, 413 and any other 4xx: envelope, permanent", async () => {
    const sender = await open();
    for (const status of [400, 404, 413, 422]) {
      graph.respondNext(status, { error: { code: "Whatever" } });
      expect(await failureOf(sender.send(simple(["b@x.test"])))).toMatchObject({
        stage: "envelope",
        permanent: true,
        soft: false,
        responseCode: status,
      });
    }
  });

  test("7b. 429 and 503: connect, soft", async () => {
    const sender = await open();
    for (const status of [429, 503]) {
      graph.respondNext(status);
      expect(await failureOf(sender.send(simple(["b@x.test"])))).toMatchObject({
        stage: "connect",
        soft: true,
        permanent: false,
        responseCode: status,
      });
    }
  });

  test("7c. 500, 502, 504 and a 200 that is not 202: unknown (the server may have the mail)", async () => {
    const sender = await open();
    for (const status of [500, 502, 504, 200]) {
      graph.respondNext(status);
      expect(await failureOf(sender.send(simple(["b@x.test"])))).toMatchObject({
        stage: "unknown",
        soft: false,
        permanent: false,
        responseCode: status,
      });
    }
  });

  test("7d. no answer within the timeout: unknown", async () => {
    const sender = await open({ timeoutMs: 200 });
    graph.hangNext();
    expect(await failureOf(sender.send(simple(["b@x.test"])))).toMatchObject({ stage: "unknown", responseCode: null });
    expect(graph.calls).toHaveLength(1);
  });

  test("7e. a server that is not there (connection refused): connect, soft, nothing sent", async () => {
    const dead = await startFakeGraph();
    const baseUrl = dead.baseUrl;
    await dead.stop();
    const sender = await open({ baseUrl });
    expect(await failureOf(sender.send(simple(["b@x.test"])))).toMatchObject({ stage: "connect", soft: true });
  });

  /** A raw TCP server: it reads the whole request (the headers and the body), then runs `act` on the socket. */
  async function rawServer(act: (socket: Socket) => void): Promise<{ baseUrl: string; server: Server }> {
    const server = createServer((socket) => {
      let seen = Buffer.alloc(0);
      let acted = false;
      socket.on("error", () => undefined);
      socket.on("data", (chunk) => {
        seen = Buffer.concat([seen, chunk]);
        const end = seen.indexOf("\r\n\r\n");
        if (acted || end === -1) return;
        const length = Number(/content-length: (\d+)/i.exec(seen.subarray(0, end).toString("latin1"))?.[1] ?? "0");
        if (seen.length - (end + 4) < length) return;
        acted = true;
        act(socket);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("no port");
    return { baseUrl: `http://127.0.0.1:${address.port}`, server };
  }

  test("7g. the connection is reset after the request left: unknown, not connect (the server may have the mail)", async () => {
    const { baseUrl, server } = await rawServer((socket) => socket.destroy());
    try {
      const sender = await open({ baseUrl });
      expect(await failureOf(sender.send(simple(["b@x.test"])))).toMatchObject({
        stage: "unknown",
        soft: false,
        permanent: false,
        responseCode: null,
      });
    } finally {
      server.close();
    }
  });

  test("7h. a half response (the headers started, never ended, then the socket is destroyed): unknown", async () => {
    const { baseUrl, server } = await rawServer((socket) => {
      // The header block never ends, so `fetch` has no response to return.
      socket.write("HTTP/1.1 202 Accepted\r\ncontent-le", () => socket.destroy());
    });
    try {
      const sender = await open({ baseUrl });
      expect(await failureOf(sender.send(simple(["b@x.test"])))).toMatchObject({ stage: "unknown", soft: false });
    } finally {
      server.close();
    }
  });

  test("7f. a redirect is not followed: no request, with or without the token, reaches another host", async () => {
    // A plain counting server: it counts every request, also a malformed one that the fake Graph would refuse.
    const hits: string[] = [];
    const other = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) => {
        hits.push(request.url);
        return new Response(null, { status: 202 });
      },
    });
    const redirector = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () =>
        new Response(null, { status: 307, headers: { location: `http://127.0.0.1:${other.port}/v1.0/me/sendMail` } }),
    });
    try {
      const sender = await open({ baseUrl: `http://127.0.0.1:${redirector.port}` });
      expect(await failureOf(sender.send(simple(["b@x.test"])))).toMatchObject({ stage: "unknown" });
      expect(hits).toEqual([]);
    } finally {
      await redirector.stop(true);
      await other.stop(true);
    }
  });

  test("a closed sender sends nothing", async () => {
    const sender = await open();
    await sender.close();
    expect(await failureOf(sender.send(simple(["b@x.test"])))).toMatchObject({ stage: "connect" });
    expect(graph.calls).toHaveLength(0);
  });
});

describe("12. canary: the token and the mail stay out of logs and errors", () => {
  test("no bearer token, body or address in a log line or an error, over every outcome", async () => {
    const lines: string[] = [];
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      spyOn(console, method).mockImplementation((...args: unknown[]) => void lines.push(format(...args)))
    );
    setLogFormat("json");
    setLogLevel("debug");
    const seen: string[] = [];
    try {
      const sender = await open();
      const input = {
        envelope: { from: FROM, to: ["secret-recipient@x.test"] },
        raw: rawOf(["To: secret-recipient@x.test"], "secret-body-text\r\n"),
      };
      const outcomes: [number, unknown?][] = [
        [202],
        [401],
        [403, { error: { code: "ErrorAccessDenied", message: "secret-recipient@x.test secret-body-text" } }],
        [400, { error: { code: "Bad", message: "secret-body-text" } }],
        [429],
        [500, { error: { message: "secret-body-text" } }],
      ];
      for (const [status, body] of outcomes) {
        graph.respondNext(status, body);
        if (status === 401) graph.respondNext(401);
        try {
          await sender.send(input);
        } catch (error) {
          seen.push(inspect(error, { depth: 8 }));
        }
      }
      // The paths with no HTTP status: no answer in time, and a closed port.
      graph.hangNext();
      const impatient = await open({ timeoutMs: 100 });
      seen.push(inspect(await failureOf(impatient.send(input)), { depth: 8 }));
      const dead = await startFakeGraph();
      const baseUrl = dead.baseUrl;
      await dead.stop();
      const unreachable = await open({ baseUrl });
      seen.push(inspect(await failureOf(unreachable.send(input)), { depth: 8 }));
    } finally {
      for (const spy of spies) spy.mockRestore();
      setLogFormat(logFormatFromEnv(process.env));
    }
    const everything = [...lines, ...seen].join("\n");
    expect(lines.length).toBeGreaterThan(0);
    for (const secret of [
      TOKEN,
      FRESH,
      "secret-recipient",
      "secret-body-text",
      Buffer.from("secret-body-text").toString("base64"),
    ]) {
      expect(everything).not.toContain(secret);
    }
    expect(everything).not.toContain("dropped_fields");
  });
});
