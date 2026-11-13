import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { connect, createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer as createTlsServer, type Server as TlsServer, type TLSSocket } from "node:tls";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { HardError } from "../../../platform/errors";

import { buildSmtpTransportOptions, openSmtpSender, verifySmtpLogin, type SmtpConnectOptions } from "./smtp";

// A scripted SMTP server that offers STARTTLS and AUTH only after the upgrade. Its certificate is self-signed
// (made with openssl for the test): only a client that is given this certificate as a CA may trust it.
// At STARTTLS the plain server relays the connection to a second, TLS-only server, because Bun 1.3.14 cannot
// upgrade an accepted socket on the server side.
let dir = "";
let key = "";
let cert = "";
const servers: (Server | TlsServer)[] = [];

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "ea-starttls-"));
  execFileSync(
    "openssl",
    [
      ...["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2", "-subj", "/CN=127.0.0.1"],
      // Bun 1.3.14 (.bun-version) checks a socket upgraded to an IP host against "localhost": the DNS name lets the
      // test run there. Remove DNS:localhost when .bun-version moves past 1.3.
      ...[
        "-addext",
        "subjectAltName=IP:127.0.0.1,DNS:localhost",
        "-keyout",
        join(dir, "key.pem"),
        "-out",
        join(dir, "cert.pem"),
      ],
    ],
    { stdio: "ignore" }
  );
  key = readFileSync(join(dir, "key.pem"), "utf8");
  cert = readFileSync(join(dir, "cert.pem"), "utf8");
});

afterAll(() => {
  for (const server of servers) server.close();
  rmSync(dir, { recursive: true, force: true });
});

interface Fake {
  port: number;
  /** What the server saw, in order: `STARTTLS`, `AUTH plain`, `AUTH tls`, `MAIL`, `DATA`. */
  seen: string[];
}

function startServer(opts: { offerStartTls: boolean }): Promise<Fake> {
  return new Promise((resolve) => {
    const seen: string[] = [];
    let tlsPort = 0;
    const handle = (socket: Socket | TLSSocket, tls: boolean): void => {
      let buffer = "";
      let dataMode = false;
      socket.on("error", () => undefined);
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
          const upper = buffer.slice(0, nl).toUpperCase();
          buffer = buffer.slice(nl + 2);
          if (upper.startsWith("EHLO")) {
            const starttls = !tls && opts.offerStartTls ? "250-STARTTLS\r\n" : "";
            const auth = tls || !opts.offerStartTls ? "250-AUTH PLAIN\r\n" : "";
            socket.write(`250-fake\r\n${starttls}${auth}250 8BITMIME\r\n`);
          } else if (upper === "STARTTLS" && !opts.offerStartTls) {
            socket.write("502 5.5.1 not offered\r\n");
          } else if (upper === "STARTTLS") {
            seen.push("STARTTLS");
            socket.removeAllListeners("data");
            socket.pause();
            const inner = connect(tlsPort, "127.0.0.1", () => {
              socket.write("220 2.0.0 ready\r\n");
              socket.pipe(inner);
              inner.pipe(socket);
              socket.resume();
            });
            inner.on("error", () => undefined);
            return;
          } else if (upper.startsWith("AUTH")) {
            seen.push(tls ? "AUTH tls" : "AUTH plain");
            socket.write("235 2.7.0 ok\r\n");
          } else if (upper.startsWith("MAIL FROM")) {
            seen.push("MAIL");
            socket.write("250 ok\r\n");
          } else if (upper === "DATA") {
            seen.push("DATA");
            dataMode = true;
            socket.write("354 go\r\n");
          } else if (upper === "QUIT") {
            socket.write("221 bye\r\n");
            socket.end();
          } else socket.write("250 ok\r\n");
        }
      });
      if (!tls) socket.write("220 fake ESMTP\r\n");
    };
    const tlsServer = createTlsServer({ key, cert }, (socket) => handle(socket, true));
    const server = createServer((raw) => handle(raw, false));
    servers.push(tlsServer, server);
    tlsServer.listen(0, "127.0.0.1", () => {
      const tlsAddress = tlsServer.address();
      tlsPort = typeof tlsAddress === "object" && tlsAddress ? tlsAddress.port : 0;
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        resolve({ port: typeof address === "object" && address ? address.port : 0, seen });
      });
    });
  });
}

const base = { host: "127.0.0.1", user: "owner@x.test", password: "pw-secret-1", security: "starttls" } as const;
const RAW = Buffer.from(
  "Message-ID: <x@ea.local>\r\nFrom: owner@x.test\r\nTo: d@x.test\r\nSubject: p\r\n\r\nhello\r\n"
);
const ENVELOPE = { from: "owner@x.test", to: ["d@x.test"] };

describe("buildSmtpTransportOptions with STARTTLS", () => {
  const creds = { user: "me@icloud.com", password: "pw" };

  test("a remote host gets secure false, requireTLS and no way to skip the certificate check", () => {
    const options = buildSmtpTransportOptions(
      { host: "smtp.mail.me.com", port: 587, security: "starttls", ...creds },
      { host: "smtp.mail.me.com" }
    );
    expect(options).toMatchObject({ host: "smtp.mail.me.com", port: 587, secure: false, requireTLS: true });
    expect("ignoreTLS" in options).toBe(false);
    expect("tls" in options).toBe(false);
  });

  test("a loopback host still requires TLS", () => {
    const options = buildSmtpTransportOptions(
      { host: "127.0.0.1", port: 3025, security: "starttls", ...creds },
      { host: "127.0.0.1" }
    );
    expect(options).toMatchObject({ secure: false, requireTLS: true });
    expect("ignoreTLS" in options).toBe(false);
  });

  test("a CA adds trust and never sets rejectUnauthorized", () => {
    const options = buildSmtpTransportOptions(
      { host: "h.test", port: 587, security: "starttls", ca: "PEM", ...creds },
      { host: "h.test" }
    );
    expect(options.tls).toEqual({ ca: "PEM" });
  });

  test("the plain-loopback switch is refused with STARTTLS", () => {
    expect(() =>
      buildSmtpTransportOptions(
        { host: "127.0.0.1", port: 587, security: "starttls", secure: false, ...creds },
        { host: "127.0.0.1" }
      )
    ).toThrow(HardError);
  });

  test("tls keeps implicit TLS", () => {
    expect(
      buildSmtpTransportOptions(
        { host: "smtp.gmail.com", port: 465, security: "tls", ...creds },
        { host: "smtp.gmail.com" }
      )
    ).toMatchObject({
      secure: true,
    });
  });
});

describe("STARTTLS against a scripted server with a self-signed certificate", () => {
  test("verifySmtpLogin upgrades first and logs in only inside TLS when the certificate is trusted", async () => {
    const fake = await startServer({ offerStartTls: true });
    const opts: SmtpConnectOptions = { ...base, port: fake.port, ca: cert };
    await verifySmtpLogin(opts);
    expect(fake.seen).toEqual(["STARTTLS", "AUTH tls"]);
  });

  test("openSmtpSender sends after the upgrade", async () => {
    const fake = await startServer({ offerStartTls: true });
    const sender = await openSmtpSender({ ...base, port: fake.port, ca: cert });
    const result = await sender.send({ envelope: ENVELOPE, raw: RAW });
    expect(result.response.startsWith("250")).toBe(true);
    expect(result.accepted).toEqual(["d@x.test"]);
    expect(fake.seen).toEqual(["STARTTLS", "AUTH tls", "MAIL", "DATA"]);
  });

  test("an untrusted certificate is refused and no password goes out", async () => {
    const fake = await startServer({ offerStartTls: true });
    const error = await verifySmtpLogin({ ...base, port: fake.port }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HardError);
    expect(fake.seen).toEqual(["STARTTLS"]);
    const sender = await openSmtpSender({ ...base, port: fake.port });
    const sendError = await sender.send({ envelope: ENVELOPE, raw: RAW }).catch((e: unknown) => e);
    expect(sendError).toMatchObject({ stage: "connect", soft: false });
    expect(fake.seen).not.toContain("AUTH tls");
    expect(fake.seen).not.toContain("AUTH plain");
  });

  test("a server without STARTTLS is refused and no password goes out", async () => {
    const fake = await startServer({ offerStartTls: false });
    const error = await verifySmtpLogin({ ...base, port: fake.port, ca: cert }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(fake.seen).toEqual([]);
  });
});
