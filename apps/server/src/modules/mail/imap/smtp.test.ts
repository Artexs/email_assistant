import { createServer, type Server, type Socket } from "node:net";

import { afterEach, describe, expect, test } from "bun:test";
import SMTPConnection from "nodemailer/lib/smtp-connection";

import { HardError, SoftError } from "../../../platform/errors";
import { MailAuthError, SmtpSendError } from "../port";

import {
  classifySmtpError,
  createSmtpMarks,
  openSmtpSender,
  smtpTransportOptions,
  toSmtpError,
  type SmtpConnectionLike,
  type SmtpConnectOptions,
  type SmtpMarks,
} from "./smtp";

const creds = { user: "me@interia.pl", password: "pw-secret-1" };

describe("smtpTransportOptions", () => {
  test("a remote host gets TLS on and no tls key", () => {
    const options = smtpTransportOptions({ host: "poczta.interia.pl", port: 465, ...creds });
    expect(options.secure).toBe(true);
    expect("tls" in options).toBe(false);
    expect("ignoreTLS" in options).toBe(false);
    expect(options).toMatchObject({
      host: "poczta.interia.pl",
      port: 465,
      auth: { user: creds.user, pass: creds.password },
    });
  });

  test("timeoutMs sets the three timeouts; without it none is set", () => {
    const set = smtpTransportOptions({ host: "poczta.interia.pl", port: 465, timeoutMs: 20_000, ...creds });
    expect(set.connectionTimeout).toBe(20_000);
    expect(set.greetingTimeout).toBe(20_000);
    expect(set.socketTimeout).toBe(20_000);
    const bare = smtpTransportOptions({ host: "poczta.interia.pl", port: 465, ...creds });
    expect("connectionTimeout" in bare).toBe(false);
    expect("greetingTimeout" in bare).toBe(false);
    expect("socketTimeout" in bare).toBe(false);
  });

  test("a loopback host gets plain SMTP with ignoreTLS", () => {
    const options = smtpTransportOptions({ host: "127.0.0.1", port: 3025, ...creds });
    expect(options.secure).toBe(false);
    expect(options.ignoreTLS).toBe(true);
    expect("tls" in options).toBe(false);
  });

  test("a loopback host with secure true keeps TLS on", () => {
    const options = smtpTransportOptions({ host: "localhost", port: 3465, secure: true, ...creds });
    expect(options.secure).toBe(true);
    expect("ignoreTLS" in options).toBe(false);
  });

  test("secure false with a remote host throws HardError", () => {
    expect(() => smtpTransportOptions({ host: "poczta.interia.pl", port: 587, secure: false, ...creds })).toThrow(
      new HardError("plain SMTP is allowed only to a loopback host")
    );
  });
});

describe("toSmtpError", () => {
  test("EAUTH gives MailAuthError without the password", () => {
    const original = Object.assign(new Error(`Invalid login for ${creds.password}`), { code: "EAUTH" });
    const error = toSmtpError(original);
    expect(error).toBeInstanceOf(MailAuthError);
    expect(error.message).not.toContain(creds.password);
    expect(error.cause).toBe(original);
  });

  test("connection errors give SoftError", () => {
    const cases = [
      { code: "ECONNECTION" },
      { code: "ETIMEDOUT" },
      { code: "EDNS", originalCode: "ENOTFOUND" },
      { code: "ESOCKET", originalCode: "ECONNREFUSED" },
      { code: "ESOCKET", originalCode: "ECONNRESET" },
      { code: "ESOCKET", originalCode: "EPIPE" },
    ];
    for (const fields of cases) {
      const original = Object.assign(new Error("x"), fields);
      const error = toSmtpError(original);
      expect(error).toBeInstanceOf(SoftError);
      expect(error.cause).toBe(original);
    }
  });

  test("a certificate error and other errors give HardError", () => {
    const cert = Object.assign(new Error("self-signed certificate"), {
      code: "ESOCKET",
      originalCode: "DEPTH_ZERO_SELF_SIGNED_CERT",
    });
    const error = toSmtpError(cert);
    expect(error).toBeInstanceOf(HardError);
    expect(error).not.toBeInstanceOf(MailAuthError);
    expect(error.cause).toBe(cert);
    expect(toSmtpError(Object.assign(new Error("x"), { code: "ETLS" }))).toBeInstanceOf(HardError);
    expect(toSmtpError("text")).toBeInstanceOf(HardError);
  });

  test("typed errors pass through", () => {
    const hard = new HardError("x");
    expect(toSmtpError(hard)).toBe(hard);
  });
});

// A scripted SMTP server on loopback. The replies per scenario are set in `Script`.
interface Script {
  pipelining?: boolean;
  greeting?: "ok" | "drop";
  auth?: "ok" | "535";
  mailFrom?: string;
  rcpt?: string[]; // reply per RCPT TO line, else "250 ok"
  data?: "354" | "250" | "554" | "drop";
  afterContent?: "250" | "552" | "451" | "drop" | "silent";
  dropAfterReplies?: number; // destroy after this many MAIL FROM / RCPT TO / DATA replies
}

const servers: Server[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

function startServer(script: Script): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer((socket: Socket) => {
      let buffer = "";
      let dataMode = false;
      let rcptSeen = 0;
      let replies = 0;
      const write = (line: string) => socket.write(`${line}\r\n`);
      const envelopeReply = (line: string) => {
        replies += 1;
        write(line);
        if (script.dropAfterReplies === replies) socket.destroy();
      };
      socket.on("error", () => undefined);
      if (script.greeting === "drop") {
        socket.write("220 fake ESMTP\r\n");
        socket.destroy();
        return;
      }
      socket.write("220 fake ESMTP\r\n");
      socket.on("data", (chunk) => {
        buffer += chunk.toString("binary");
        for (;;) {
          if (dataMode) {
            const end = buffer.indexOf("\r\n.\r\n");
            if (end === -1) return;
            buffer = buffer.slice(end + 5);
            dataMode = false;
            const after = script.afterContent ?? "250";
            if (after === "drop") socket.destroy();
            else if (after === "552") write("552 5.3.4 message too big");
            else if (after === "451") write("451 4.3.0 try later");
            else if (after === "250") write("250 2.0.0 Ok: queued as ABC123");
            continue;
          }
          const nl = buffer.indexOf("\r\n");
          if (nl === -1) return;
          const upper = buffer.slice(0, nl).toUpperCase();
          buffer = buffer.slice(nl + 2);
          if (upper.startsWith("EHLO")) {
            socket.write(
              `250-fake\r\n250-AUTH PLAIN LOGIN\r\n${script.pipelining ? "250-PIPELINING\r\n" : ""}250 8BITMIME\r\n`
            );
          } else if (upper.startsWith("AUTH")) write(script.auth === "535" ? "535 5.7.8 bad" : "235 2.7.0 ok");
          else if (upper.startsWith("MAIL FROM")) envelopeReply(script.mailFrom ?? "250 2.1.0 ok");
          else if (upper.startsWith("RCPT TO")) {
            envelopeReply(script.rcpt?.[rcptSeen] ?? "250 2.1.5 ok");
            rcptSeen += 1;
          } else if (upper === "DATA") {
            const mode = script.data ?? "354";
            if (mode === "drop") socket.destroy();
            else if (mode === "554") envelopeReply("554 5.5.1 no");
            else {
              replies += 1;
              dataMode = true;
              write(mode === "250" ? "250 go ahead (non-standard)" : "354 go");
              if (script.dropAfterReplies === replies) socket.destroy();
            }
          } else if (upper === "QUIT") {
            write("221 bye");
            socket.end();
          } else write("250 ok");
        }
      });
    });
    servers.push(server);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });
}

const PASSWORD = "pw-secret-1";
const BODY_MARKER = "SECRET-BODY-MARKER";
const RAW = Buffer.from(
  `Message-ID: <x@ea.local>\r\nFrom: owner@x.test\r\nTo: delegate@x.test\r\nSubject: p\r\n\r\n${BODY_MARKER} hello\r\n`
);
const ENVELOPE = { from: "owner@x.test", to: ["delegate@x.test"] };

function connectOptions(port: number): SmtpConnectOptions {
  return { host: "127.0.0.1", port, user: "owner@x.test", password: PASSWORD, secure: false };
}

async function sendFailure(
  script: Script,
  to: string[] = ENVELOPE.to,
  deps?: Parameters<typeof openSmtpSender>[1]
): Promise<unknown> {
  const port = await startServer(script);
  const sender = await openSmtpSender(connectOptions(port), deps);
  try {
    await sender.send({ envelope: { from: ENVELOPE.from, to }, raw: RAW });
  } catch (error) {
    return error;
  }
  throw new Error("the send succeeded");
}

function expectSmtp(error: unknown): SmtpSendError {
  expect(error).toBeInstanceOf(SmtpSendError);
  return error as SmtpSendError;
}

function stubConnection(opts: { sendError?: Error; closeThrows?: boolean; mutate?: boolean }): SmtpConnectionLike {
  let onEnd: () => void = () => undefined;
  return {
    connect: (cb) => cb(),
    login: (_auth, cb) => cb(null),
    send: (envelope, _message, cb) => {
      if (opts.mutate) Object.assign(envelope, { accepted: ["x"], rejected: [], rejectedErrors: [] });
      if (opts.sendError) cb(opts.sendError);
      else cb(null, { response: "250 ok", accepted: [...envelope.to], rejected: [] });
    },
    quit: () => onEnd(),
    close: () => {
      if (opts.closeThrows) throw new Error("close failed");
    },
    on: (event: string, listener: unknown) => {
      if (event === "end") onEnd = listener as () => void;
    },
  } as SmtpConnectionLike;
}

describe("openSmtpSender with a stub connection", () => {
  test("the caller's envelope object is unchanged after a send", async () => {
    const sender = await openSmtpSender(connectOptions(1), { connection: () => stubConnection({ mutate: true }) });
    const envelope = { from: "owner@x.test", to: ["delegate@x.test"] };
    await sender.send({ envelope, raw: RAW });
    expect(envelope).toEqual({ from: "owner@x.test", to: ["delegate@x.test"] });
  });

  test("a close error does not replace the send result", async () => {
    const sender = await openSmtpSender(connectOptions(1), { connection: () => stubConnection({ closeThrows: true }) });
    const result = await sender.send({ envelope: ENVELOPE, raw: RAW });
    expect(result.response).toBe("250 ok");
  });

  test("a close error does not replace the typed SmtpSendError", async () => {
    const sendError = Object.assign(new Error("x"), { code: "EENVELOPE", responseCode: 550 });
    const sender = await openSmtpSender(connectOptions(1), {
      connection: () => stubConnection({ closeThrows: true, sendError }),
    });
    const error = expectSmtp(await sender.send({ envelope: ENVELOPE, raw: RAW }).catch((e: unknown) => e));
    expect(error).toMatchObject({ stage: "envelope", code: "EENVELOPE" });
  });
});

describe("openSmtpSender against a scripted server", () => {
  test("(1) ok gives the 250 line and the accepted recipient", async () => {
    const port = await startServer({});
    const sender = await openSmtpSender(connectOptions(port));
    const result = await sender.send({ envelope: ENVELOPE, raw: RAW });
    expect(result.response.startsWith("250")).toBe(true);
    expect(result.accepted).toEqual(["delegate@x.test"]);
    expect(result.rejected).toEqual([]);
    await sender.close();
  });

  test("(2) a closed port gives stage connect, ESOCKET, soft", async () => {
    const port = await startServer({});
    servers.pop()?.close();
    const sender = await openSmtpSender(connectOptions(port));
    const error = expectSmtp(await sender.send({ envelope: ENVELOPE, raw: RAW }).catch((e: unknown) => e));
    expect(error).toMatchObject({ stage: "connect", code: "ESOCKET", soft: true });
  });

  test("(3) a close after the greeting gives stage connect, ECONNECTION, soft", async () => {
    const error = expectSmtp(await sendFailure({ greeting: "drop" }));
    expect(error).toMatchObject({ stage: "connect", code: "ECONNECTION", soft: true });
  });

  test("(4) a 535 gives MailAuthError", async () => {
    const error = await sendFailure({ auth: "535" });
    expect(error).toBeInstanceOf(MailAuthError);
    expect((error as Error).message).not.toContain(PASSWORD);
  });

  test("(5) a 550 to RCPT TO gives stage envelope, permanent, not soft", async () => {
    const error = expectSmtp(await sendFailure({ rcpt: ["550 5.1.1 unknown"] }));
    expect(error).toMatchObject({
      stage: "envelope",
      code: "EENVELOPE",
      responseCode: 550,
      permanent: true,
      soft: false,
    });
  });

  test("(6) a 450 to RCPT TO gives stage envelope, soft, not permanent", async () => {
    const error = expectSmtp(await sendFailure({ rcpt: ["450 4.2.0 later"] }));
    expect(error).toMatchObject({
      stage: "envelope",
      code: "EENVELOPE",
      responseCode: 450,
      permanent: false,
      soft: true,
    });
  });

  test("(7) a 554 to the DATA command gives stage envelope, permanent", async () => {
    const error = expectSmtp(await sendFailure({ data: "554" }));
    expect(error).toMatchObject({ stage: "envelope", responseCode: 554, permanent: true });
  });

  test("(8) a drop on the DATA command gives stage envelope, ECONNECTION, soft", async () => {
    const error = expectSmtp(await sendFailure({ data: "drop" }));
    expect(error).toMatchObject({ stage: "envelope", code: "ECONNECTION", soft: true });
  });

  test("(8b) DATA answered with 250 and a drop after the content gives unknown", async () => {
    const error = expectSmtp(await sendFailure({ data: "250", afterContent: "drop" }));
    expect(error).toMatchObject({ stage: "unknown", code: "ECONNECTION", soft: true });
  });

  describe("(8c) PIPELINING", () => {
    test("a drop after the MAIL FROM reply only gives stage envelope", async () => {
      const error = expectSmtp(await sendFailure({ pipelining: true, dropAfterReplies: 1 }));
      expect(error).toMatchObject({ stage: "envelope", code: "ECONNECTION" });
    });

    test("all three replies and a drop after the content give unknown", async () => {
      const error = expectSmtp(await sendFailure({ pipelining: true, afterContent: "drop" }));
      expect(error).toMatchObject({ stage: "unknown", code: "ECONNECTION" });
    });

    test("with two recipients the DATA reply is the fourth: a drop after three replies gives envelope", async () => {
      const to = ["a@x.test", "b@x.test"];
      const early = expectSmtp(await sendFailure({ pipelining: true, dropAfterReplies: 3 }, to));
      expect(early.stage).toBe("envelope");
      const late = expectSmtp(await sendFailure({ pipelining: true, afterContent: "drop" }, to));
      expect(late.stage).toBe("unknown");
    });
  });

  test("(9) a 552 after the content gives stage content, EMESSAGE, permanent", async () => {
    const error = expectSmtp(await sendFailure({ afterContent: "552" }));
    expect(error).toMatchObject({ stage: "content", code: "EMESSAGE", responseCode: 552, permanent: true });
  });

  test("(10) a 451 after the content gives stage content, soft", async () => {
    const error = expectSmtp(await sendFailure({ afterContent: "451" }));
    expect(error).toMatchObject({ stage: "content", responseCode: 451, soft: true, permanent: false });
  });

  test("(11) a drop after the content gives unknown, ECONNECTION", async () => {
    const error = expectSmtp(await sendFailure({ afterContent: "drop" }));
    expect(error).toMatchObject({ stage: "unknown", code: "ECONNECTION" });
  });

  test("(12) a timeout after the content gives unknown, ETIMEDOUT", async () => {
    const error = expectSmtp(
      await sendFailure({ afterContent: "silent" }, ENVELOPE.to, {
        connection: (options) => new SMTPConnection({ ...options, socketTimeout: 500 }),
      })
    );
    expect(error).toMatchObject({ stage: "unknown", code: "ETIMEDOUT" });
  });

  test("(14) the hook sees neither the body nor the password", async () => {
    const seen: string[] = [];
    const record = (...args: unknown[]) => {
      seen.push(args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "));
    };
    const port = await startServer({});
    const sender = await openSmtpSender(connectOptions(port), {
      connection: (options) => {
        const marks = (options as { logger: Record<string, (...args: unknown[]) => void> }).logger;
        const wrapped = Object.fromEntries(
          Object.entries(marks).map(([name, method]) => [
            name,
            (entry: unknown, message: unknown, ...rest: unknown[]) => {
              record(message, ...rest);
              return method(entry, message, ...rest);
            },
          ])
        );
        return new SMTPConnection({ ...options, logger: wrapped });
      },
    });
    await sender.send({ envelope: ENVELOPE, raw: RAW });
    expect(seen.length).toBeGreaterThan(0);
    const all = seen.join("\n");
    expect(all).not.toContain(BODY_MARKER);
    expect(all).not.toContain(PASSWORD);
    expect(all).not.toContain(Buffer.from(`\0owner@x.test\0${PASSWORD}`).toString("base64"));
  });

  test("(15) the error message holds no address", async () => {
    const errors = [
      await sendFailure({ rcpt: ["550 5.1.1 unknown delegate@x.test"] }),
      await sendFailure({ afterContent: "552" }),
      await sendFailure({ afterContent: "drop" }),
    ];
    for (const error of errors) expect((error as Error).message).not.toContain("@");
  });
});

function marks(partial: Partial<SmtpMarks> = {}): SmtpMarks {
  return {
    clientLines: 4,
    mailFromSent: true,
    rcptLines: 1,
    dataSent: false,
    repliesAfterMailFrom: 0,
    contentStarted: false,
    ...partial,
  };
}

function nodemailerError(fields: Record<string, unknown>): Error {
  return Object.assign(new Error("boom delegate@x.test"), fields);
}

describe("classifySmtpError", () => {
  test("a permanent reply is never soft", () => {
    const error = classifySmtpError(nodemailerError({ code: "ECONNECTION", responseCode: 554 }), "send", marks());
    expect(error).toMatchObject({
      stage: "envelope",
      code: "ECONNECTION",
      responseCode: 554,
      permanent: true,
      soft: false,
    });
  });

  test("EAUTH is a MailAuthError at every step", () => {
    for (const step of ["connect", "login", "send"] as const) {
      const error = classifySmtpError(nodemailerError({ code: "EAUTH" }), step, marks());
      expect(error).toBeInstanceOf(MailAuthError);
    }
  });

  test("the connect and login steps set the stage", () => {
    const connect = classifySmtpError(nodemailerError({ code: "ECONNECTION" }), "connect", marks());
    expect(connect).toMatchObject({ stage: "connect", soft: true });
    const login = classifySmtpError(nodemailerError({ code: "ETIMEDOUT" }), "login", marks());
    expect(login).toMatchObject({ stage: "login", soft: true });
  });

  test("send: EENVELOPE is envelope and EMESSAGE is content, whatever the marks", () => {
    const started = marks({ contentStarted: true });
    expect(classifySmtpError(nodemailerError({ code: "EENVELOPE", responseCode: 550 }), "send", started)).toMatchObject(
      {
        stage: "envelope",
        permanent: true,
        soft: false,
      }
    );
    expect(classifySmtpError(nodemailerError({ code: "EMESSAGE", responseCode: 451 }), "send", marks())).toMatchObject({
      stage: "content",
      permanent: false,
      soft: true,
    });
    expect(classifySmtpError(nodemailerError({ code: "EMESSAGE", responseCode: 552 }), "send", marks())).toMatchObject({
      stage: "content",
      permanent: true,
      soft: false,
    });
  });

  test("send: a connection error is unknown after the content began, else envelope", () => {
    const error = nodemailerError({ code: "ECONNECTION" });
    expect(classifySmtpError(error, "send", marks({ contentStarted: true }))).toMatchObject({
      stage: "unknown",
      soft: true,
    });
    expect(classifySmtpError(error, "send", marks())).toMatchObject({ stage: "envelope", soft: true });
  });

  test("send: clientLines 0 gives unknown for a connection error but not for EENVELOPE", () => {
    const blind = marks({ clientLines: 0 });
    expect(classifySmtpError(nodemailerError({ code: "ECONNECTION" }), "send", blind)).toMatchObject({
      stage: "unknown",
    });
    expect(classifySmtpError(nodemailerError({ code: "ETIMEDOUT" }), "send", blind)).toMatchObject({
      stage: "unknown",
    });
    expect(classifySmtpError(nodemailerError({ code: "EENVELOPE" }), "send", blind)).toMatchObject({
      stage: "envelope",
    });
  });

  test("soft and permanent flags", () => {
    const soft = (fields: Record<string, unknown>) =>
      (classifySmtpError(nodemailerError(fields), "send", marks()) as SmtpSendError).soft;
    expect(soft({ code: "ETIMEDOUT" })).toBe(true);
    expect(soft({ code: "EDNS" })).toBe(true);
    expect(soft({ code: "ESOCKET", originalCode: "ECONNRESET" })).toBe(true);
    expect(soft({ code: "ESOCKET", originalCode: "DEPTH_ZERO_SELF_SIGNED_CERT" })).toBe(false);
    expect(soft({ code: "ETLS" })).toBe(false);
    expect(soft({ code: "EPROTOCOL" })).toBe(false);
    expect(soft({ code: "EENVELOPE", responseCode: 421 })).toBe(true);
    expect(soft({ code: "EENVELOPE", responseCode: 550 })).toBe(false);
    expect(soft({})).toBe(false);
    const permanent = classifySmtpError(nodemailerError({ code: "EENVELOPE", permanent: true }), "send", marks());
    expect((permanent as SmtpSendError).permanent).toBe(true);
    const unknownCode = classifySmtpError(nodemailerError({}), "send", marks()) as SmtpSendError;
    expect(unknownCode.code).toBe("UNKNOWN");
    expect(unknownCode.responseCode).toBeNull();
  });

  test("the message holds the stage, the code and the response code only", () => {
    const error = classifySmtpError(
      nodemailerError({ code: "EENVELOPE", responseCode: 550, response: "550 no such user delegate@x.test" }),
      "send",
      marks()
    );
    expect(error.message).toBe("SMTP send failed: stage envelope, code EENVELOPE, response 550");
  });

  test("the original error is the cause", () => {
    const original = nodemailerError({ code: "ECONNECTION" });
    expect(classifySmtpError(original, "send", marks()).cause).toBe(original);
  });
});

describe("createSmtpMarks", () => {
  type Entry = ["client" | "server" | "other", string];

  function feed(entries: Entry[]): SmtpMarks {
    const { marks: result, logger } = createSmtpMarks();
    const log = logger as Record<string, (entry: unknown, message: string) => void>;
    for (const [tnx, text] of entries) log.debug?.({ tnx }, text);
    return result;
  }

  test("every level method updates the marks and nothing is stored", () => {
    const { marks: result, logger } = createSmtpMarks();
    const log = logger as Record<string, (entry: unknown, message: string) => void>;
    for (const level of ["trace", "debug", "info", "warn", "error", "fatal"]) {
      expect(typeof log[level]).toBe("function");
      log[level]?.({ tnx: "client" }, "NOOP");
    }
    expect(result.clientLines).toBe(6);
    expect(Object.keys(result).sort()).toEqual(
      ["clientLines", "contentStarted", "dataSent", "mailFromSent", "rcptLines", "repliesAfterMailFrom"].sort()
    );
  });

  test("plain order: the DATA reply is the third reply after MAIL FROM", () => {
    const entries: Entry[] = [
      ["server", "220 hi"],
      ["client", "EHLO ea-mail"],
      ["server", "250 ok"],
      ["client", "MAIL FROM:<a@x.test>"],
      ["server", "250 ok"],
      ["client", "RCPT TO:<b@x.test>"],
      ["server", "250 ok"],
      ["client", "DATA"],
    ];
    const before = feed(entries);
    expect(before).toMatchObject({
      mailFromSent: true,
      rcptLines: 1,
      dataSent: true,
      repliesAfterMailFrom: 2,
      contentStarted: false,
    });
    expect(feed([...entries, ["server", "250 go ahead"]]).contentStarted).toBe(true);
  });

  test("PIPELINING order: the commands come first, the replies later", () => {
    const commands: Entry[] = [
      ["client", "MAIL FROM:<a@x.test>"],
      ["client", "RCPT TO:<b@x.test>"],
      ["client", "RCPT TO:<c@x.test>"],
      ["client", "DATA"],
    ];
    expect(feed([...commands, ["server", "250 ok"]]).contentStarted).toBe(false);
    expect(feed([...commands, ["server", "250 ok"], ["server", "250 ok"], ["server", "250 ok"]]).contentStarted).toBe(
      false
    );
    expect(
      feed([...commands, ["server", "250 ok"], ["server", "250 ok"], ["server", "250 ok"], ["server", "354 go"]])
        .contentStarted
    ).toBe(true);
  });

  test("server lines before MAIL FROM and other entries are ignored", () => {
    const result = feed([
      ["server", "220 hi"],
      ["server", "250 ok"],
      ["other", "DATA"],
      ["client", "  data  "],
      ["server", "250 ok"],
    ]);
    expect(result).toMatchObject({
      clientLines: 1,
      mailFromSent: false,
      repliesAfterMailFrom: 0,
      contentStarted: false,
    });
  });
});
