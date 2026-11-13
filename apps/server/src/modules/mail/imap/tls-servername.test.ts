import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer as createTlsServer, type Server as TlsServer, type TLSSocket } from "node:tls";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { ImapFlow } from "imapflow";
import { createTransport } from "nodemailer";

import { imapFlowOptions } from "./client";
import { buildSmtpTransportOptions } from "./smtp";

// The product path for a DNS mail host: the client connects to the address that the host guard checked and
// verifies the certificate against the host name (`servername`). The certificate is self-signed for NAME and is
// given as a CA, so trust is present and only the name check can refuse.
const NAME = "mail.probe.test";
const OTHER = "other.probe.test";
let dir = "";
let key = "";
let cert = "";
const servers: TlsServer[] = [];

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "ea-tls-name-"));
  execFileSync(
    "openssl",
    [
      ...["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2", "-subj", `/CN=${NAME}`],
      ...["-addext", `subjectAltName=DNS:${NAME}`, "-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem")],
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

/** A TLS-only line server: writes `greeting`, then answers each line with `reply(line)`. */
function startTlsServer(greeting: string, reply: (line: string) => string): Promise<number> {
  return new Promise((resolve) => {
    const server = createTlsServer({ key, cert }, (socket: TLSSocket) => {
      let buffer = "";
      socket.on("error", () => undefined);
      socket.on("data", (chunk) => {
        buffer += chunk.toString("latin1");
        for (let nl = buffer.indexOf("\r\n"); nl !== -1; nl = buffer.indexOf("\r\n")) {
          const line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 2);
          socket.write(reply(line));
        }
      });
      socket.write(greeting);
    });
    servers.push(server);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });
}

function imapReply(line: string): string {
  const [tag = "*", command = ""] = line.split(" ");
  if (command.toUpperCase() === "CAPABILITY") return `* CAPABILITY IMAP4rev1 AUTH=PLAIN\r\n${tag} OK done\r\n`;
  if (command.toUpperCase() === "LOGOUT") return `* BYE bye\r\n${tag} OK done\r\n`;
  return `${tag} OK done\r\n`;
}

function smtpReply(line: string): string {
  const upper = line.toUpperCase();
  if (upper.startsWith("EHLO")) return "250-fake\r\n250-AUTH PLAIN\r\n250 8BITMIME\r\n";
  if (upper.startsWith("AUTH")) return "235 2.7.0 ok\r\n";
  if (upper === "QUIT") return "221 bye\r\n";
  return "250 ok\r\n";
}

describe("TLS to a DNS host checks the certificate against the host name", () => {
  test("IMAP accepts the certificate of the host name", async () => {
    const port = await startTlsServer("* OK [CAPABILITY IMAP4rev1 AUTH=PLAIN] ready\r\n", imapReply);
    const options = imapFlowOptions(
      { host: NAME, port, user: "u", password: "p" },
      { host: "127.0.0.1", servername: NAME }
    );
    const client = new ImapFlow({ ...options, tls: { ca: cert } });
    await client.connect();
    await client.logout();
  });

  test("IMAP refuses a certificate for another name", async () => {
    const port = await startTlsServer("* OK [CAPABILITY IMAP4rev1 AUTH=PLAIN] ready\r\n", imapReply);
    const options = imapFlowOptions(
      { host: OTHER, port, user: "u", password: "p" },
      { host: "127.0.0.1", servername: OTHER }
    );
    const client = new ImapFlow({ ...options, tls: { ca: cert } });
    client.on("error", () => undefined);
    const error = await client.connect().catch((e: unknown) => e);
    expect((error as { code?: unknown }).code).toBe("ERR_TLS_CERT_ALTNAME_INVALID");
  });

  test("SMTP accepts the certificate of the host name", async () => {
    const port = await startTlsServer("220 fake ESMTP\r\n", smtpReply);
    const options = buildSmtpTransportOptions(
      { host: NAME, port, user: "u", password: "p", security: "tls", ca: cert },
      { host: "127.0.0.1", servername: NAME }
    );
    expect(await createTransport(options).verify()).toBe(true);
  });

  test("SMTP refuses a certificate for another name", async () => {
    const port = await startTlsServer("220 fake ESMTP\r\n", smtpReply);
    const options = buildSmtpTransportOptions(
      { host: OTHER, port, user: "u", password: "p", security: "tls", ca: cert },
      { host: "127.0.0.1", servername: OTHER }
    );
    const error = await createTransport(options)
      .verify()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("does not match certificate's altnames");
  });
});
