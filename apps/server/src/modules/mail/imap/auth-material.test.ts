import { createServer, type Server, type Socket } from "node:net";

import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test, type Mock } from "bun:test";

import { HardError } from "../../../platform/errors";
import { setLogLevel } from "../../../platform/log";
import { assertAuthMaterial, MailAuthError, type AuthMaterial } from "../port";

import { connectImapClient, imapFlowOptions, type ImapConnectOptions } from "./client";
import { buildSmtpTransportOptions, openSmtpSender, verifySmtpLogin, type SmtpConnectOptions } from "./smtp";

// IMAP and SMTP log in with a password or an OAuth access token (XOAUTH2). The token must never reach
// an error message, `String(error)` or a log line.
const TOKEN = "tok-1";
const USER = "a@x.test";
const OAUTH: AuthMaterial = { kind: "oauth", accessToken: TOKEN };
const RAW = Buffer.from("Message-ID: <x@ea.local>\r\nFrom: a@x.test\r\nTo: d@x.test\r\nSubject: p\r\n\r\nhello\r\n");
const ENVELOPE = { from: USER, to: ["d@x.test"] };

const servers: Server[] = [];
let logLines: string[] = [];
let logSpies: Mock<(...args: unknown[]) => void>[] = [];

beforeAll(() => {
  setLogLevel("debug");
});

afterAll(() => {
  setLogLevel("info");
});

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
  for (const spy of logSpies) spy.mockRestore();
  logSpies = [];
});

function captureLogs(): void {
  logLines = [];
  for (const method of ["log", "error", "warn", "info", "debug"] as const) {
    const spy = spyOn(console, method).mockImplementation((...args: unknown[]) => {
      logLines.push(args.map((arg) => String(arg)).join(" "));
    });
    logSpies.push(spy as unknown as Mock<(...args: unknown[]) => void>);
  }
}

function listen(server: Server): Promise<number> {
  servers.push(server);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });
}

// A scripted SMTP server that offers only AUTH XOAUTH2. `auth` is the reply to each AUTH line; a refusal echoes the line.
interface SmtpFake {
  port: number;
  /** The text after `AUTH XOAUTH2 ` of every AUTH line, decoded from base64. */
  decoded: string[];
  connections: () => number;
}

async function startSmtp(auth: "ok" | "535" | "334-then-535"): Promise<SmtpFake> {
  const decoded: string[] = [];
  let connections = 0;
  const server = createServer((socket: Socket) => {
    connections += 1;
    let buffer = "";
    let dataMode = false;
    let authLines = 0;
    socket.on("error", () => undefined);
    socket.write("220 fake ESMTP\r\n");
    socket.on("data", (chunk) => {
      buffer += chunk.toString("latin1");
      for (;;) {
        if (dataMode) {
          const end = buffer.indexOf("\r\n.\r\n");
          if (end === -1) return;
          buffer = buffer.slice(end + 5);
          dataMode = false;
          socket.write("250 2.0.0 queued\r\n");
          continue;
        }
        const nl = buffer.indexOf("\r\n");
        if (nl === -1) return;
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 2);
        const upper = line.toUpperCase();
        if (upper.startsWith("EHLO")) socket.write("250-fake\r\n250-AUTH XOAUTH2\r\n250 8BITMIME\r\n");
        else if (upper.startsWith("AUTH XOAUTH2 ")) {
          authLines += 1;
          decoded.push(Buffer.from(line.slice("AUTH XOAUTH2 ".length), "base64").toString("latin1"));
          if (auth === "ok") socket.write("235 2.7.0 ok\r\n");
          else if (auth === "334-then-535" && authLines === 1) {
            // What Google and Microsoft do: a base64 JSON challenge first.
            const challenge = Buffer.from(JSON.stringify({ status: "401", schemes: "Bearer" })).toString("base64");
            socket.write(`334 ${challenge}\r\n`);
          } else {
            // The refusal text echoes what the client sent, as a careless server may.
            socket.write(`535 5.7.3 Authentication unsuccessful ${line.slice("AUTH XOAUTH2 ".length)}\r\n`);
          }
        } else if (upper.startsWith("MAIL FROM")) socket.write("250 ok\r\n");
        else if (upper === "DATA") {
          dataMode = true;
          socket.write("354 go\r\n");
        } else if (upper === "QUIT") {
          socket.write("221 bye\r\n");
          socket.end();
        } else socket.write("250 ok\r\n");
      }
    });
  });
  const port = await listen(server);
  return { port, decoded, connections: () => connections };
}

function smtpOptions(port: number, auth: AuthMaterial): SmtpConnectOptions {
  return { host: "127.0.0.1", port, user: USER, auth, secure: false };
}

// A scripted IMAP server that offers AUTH=XOAUTH2 and refuses every AUTHENTICATE. Its refusal text echoes what the
// client sent, as a careless server may: the mapped error must still not hold the token.
async function startImap(): Promise<{ port: number; lines: string[] }> {
  const lines: string[] = [];
  const server = createServer((socket: Socket) => {
    let buffer = "";
    socket.on("error", () => undefined);
    socket.write("* OK [CAPABILITY IMAP4rev1 AUTH=XOAUTH2] scripted\r\n");
    socket.on("data", (chunk) => {
      buffer += chunk.toString("latin1");
      for (;;) {
        const nl = buffer.indexOf("\r\n");
        if (nl === -1) return;
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 2);
        lines.push(line);
        const [tag = "", command = "", , payload = ""] = line.split(" ");
        if (command.toUpperCase() === "CAPABILITY") {
          socket.write(`* CAPABILITY IMAP4rev1 AUTH=XOAUTH2\r\n${tag} OK done\r\n`);
        } else if (command.toUpperCase() === "AUTHENTICATE") {
          socket.write(`${tag} NO [AUTHENTICATIONFAILED] AUTHENTICATE failed ${TOKEN} ${payload}\r\n`);
        } else if (command.toUpperCase() === "LOGOUT") {
          socket.write(`* BYE\r\n${tag} OK bye\r\n`);
          socket.end();
        } else socket.write(`${tag} OK\r\n`);
      }
    });
  });
  const port = await listen(server);
  return { port, lines };
}

// The token as a client sends it (base64 of the XOAUTH2 line): a careless server echoes this in its refusal text.
const ENCODED = Buffer.from(`user=${USER}\x01auth=Bearer ${TOKEN}\x01\x01`).toString("base64");

function expectNoToken(error: unknown): void {
  expect(error).toBeInstanceOf(Error);
  const shown = [String(error), (error as Error).message, String((error as Error).stack ?? ""), ...logLines].join("\n");
  expect(shown).not.toContain(TOKEN);
  expect(shown).not.toContain(ENCODED);
}

describe("imapFlowOptions with AuthMaterial", () => {
  const base = { host: "imap.x.test", port: 993, user: USER };
  const target = { host: "imap.x.test" };

  test("oauth gives auth { user, accessToken } and no pass", () => {
    const options = imapFlowOptions({ ...base, auth: OAUTH }, target);
    expect(options.auth).toEqual({ user: USER, accessToken: TOKEN });
    expect(options.auth).not.toHaveProperty("pass");
  });

  test("password gives auth { user, pass } and no accessToken", () => {
    const options = imapFlowOptions({ ...base, auth: { kind: "password", password: "pw" } }, target);
    expect(options.auth).toEqual({ user: USER, pass: "pw" });
    expect(options.auth).not.toHaveProperty("accessToken");
  });

  test("an empty password or token is a HardError before any connection", () => {
    for (const auth of [
      { kind: "password", password: "" },
      { kind: "oauth", accessToken: "" },
    ] as const) {
      expect(() => imapFlowOptions({ ...base, auth }, target)).toThrow(HardError);
      expect(() => assertAuthMaterial(auth)).toThrow(HardError);
    }
  });
});

describe("SMTP with AuthMaterial", () => {
  test("an empty password or token is a HardError before any connection", async () => {
    const fake = await startSmtp("ok");
    for (const auth of [
      { kind: "password", password: "" },
      { kind: "oauth", accessToken: "" },
    ] as const) {
      const opts = smtpOptions(fake.port, auth);
      expect(() => buildSmtpTransportOptions(opts, { host: "127.0.0.1" })).toThrow(HardError);
      expect(await verifySmtpLogin(opts).catch((e: unknown) => e)).toBeInstanceOf(HardError);
      expect(await openSmtpSender(opts).catch((e: unknown) => e)).toBeInstanceOf(HardError);
    }
    expect(fake.connections()).toBe(0);
  });

  test("verifySmtpLogin sends AUTH XOAUTH2 with user=…, auth=Bearer … and the two \\x01", async () => {
    const fake = await startSmtp("ok");
    await verifySmtpLogin(smtpOptions(fake.port, OAUTH));
    expect(fake.decoded).toEqual([`user=${USER}\x01auth=Bearer ${TOKEN}\x01\x01`]);
  });

  test("the sender logs in with the same XOAUTH2 line and sends", async () => {
    const fake = await startSmtp("ok");
    const sender = await openSmtpSender(smtpOptions(fake.port, OAUTH));
    const result = await sender.send({ envelope: ENVELOPE, raw: RAW });
    expect(result.accepted).toEqual(["d@x.test"]);
    expect(fake.decoded).toEqual([`user=${USER}\x01auth=Bearer ${TOKEN}\x01\x01`]);
  });

  test("a 535 to XOAUTH2 gives MailAuthError without the token (verify and send)", async () => {
    captureLogs();
    const fake = await startSmtp("535");
    const verifyError = await verifySmtpLogin(smtpOptions(fake.port, OAUTH)).catch((e: unknown) => e);
    expect(verifyError).toBeInstanceOf(MailAuthError);
    expect((verifyError as MailAuthError).reason).toBeUndefined();
    expectNoToken(verifyError);
    const sender = await openSmtpSender(smtpOptions(fake.port, OAUTH));
    const sendError = await sender.send({ envelope: ENVELOPE, raw: RAW }).catch((e: unknown) => e);
    expect(sendError).toBeInstanceOf(MailAuthError);
    expect(sendError).not.toHaveProperty("stage");
    expectNoToken(sendError);
  });

  test("a 334 challenge and then a 535 gives MailAuthError without the token", async () => {
    captureLogs();
    const fake = await startSmtp("334-then-535");
    const verifyError = await verifySmtpLogin(smtpOptions(fake.port, OAUTH)).catch((e: unknown) => e);
    expect(verifyError).toBeInstanceOf(MailAuthError);
    expectNoToken(verifyError);
    // nodemailer asks for a fresh token after a 334 challenge: it sent the AUTH line twice.
    expect(fake.decoded).toHaveLength(2);
    const sender = await openSmtpSender(smtpOptions(fake.port, OAUTH));
    const sendError = await sender.send({ envelope: ENVELOPE, raw: RAW }).catch((e: unknown) => e);
    expect(sendError).toBeInstanceOf(MailAuthError);
    expectNoToken(sendError);
  });
});

describe("IMAP with AuthMaterial against a scripted server", () => {
  test("a refused XOAUTH2 login gives MailAuthError without the token", async () => {
    captureLogs();
    const fake = await startImap();
    const opts: ImapConnectOptions = {
      host: "127.0.0.1",
      port: fake.port,
      user: USER,
      auth: OAUTH,
      secure: false,
      connectionTimeoutMs: 5_000,
    };
    const error = await connectImapClient(opts).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MailAuthError);
    expect((error as MailAuthError).reason).toBeUndefined();
    // The scripted server saw the AUTHENTICATE XOAUTH2 line (the client reached the login step).
    expect(fake.lines.some((line) => /^\S+ AUTHENTICATE XOAUTH2 /i.test(line))).toBe(true);
    // The refusal text echoed the token, so it sits in the cause only; the mapped message is our own text.
    expect(JSON.stringify((error as Error).cause, ["response"])).toContain(TOKEN);
    expectNoToken(error);
  });
});
