import { createHash, randomUUID } from "node:crypto";

import { afterEach, describe, expect, test } from "bun:test";

import { MailAuthError, type MailSender } from "../../src/modules/mail";

export interface MailSenderHarness {
  /** A sender for the address `from`. */
  open(opts: { from: string }): Promise<MailSender>;
  /** The raw bytes the server got for this Message-ID, or null. A server may add headers; it must keep the body. */
  received(messageId: string): Promise<Buffer | null>;
  /** A sender whose login the server refuses: the sender (its first `send` refuses) or the error of the open. */
  openRefused?(opts: { from: string }): Promise<MailSender | Error>;
  /** The two recipients of the cases. A server that makes a mailbox for each new address needs unique ones. */
  recipients?(): { b: string; c: string };
}

export interface MailSenderContractOptions {
  /** Why this server cannot refuse a login. Case 5 is skipped and the reason goes into its name. */
  noRefusal?: string;
}

const FROM = "a@x.test";

interface TestMessage {
  messageId: string;
  actionId: string;
  raw: Buffer;
  body: string;
}

function testMessage(to: string[]): TestMessage {
  const messageId = `<contract-${randomUUID()}@ea.test>`;
  const actionId = randomUUID();
  const body = `${"The quick brown fox jumps over the lazy dog. ".repeat(22)}\r\n`;
  const raw = Buffer.from(
    [
      `Message-ID: ${messageId}`,
      `X-EA-Action-Id: ${actionId}`,
      `From: ${FROM}`,
      `To: ${to.join(", ")}`,
      "Subject: contract",
      "Date: Sat, 14 Nov 2026 10:00:00 +0000",
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "",
      body,
    ].join("\r\n")
  );
  return { messageId, actionId, raw, body };
}

function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/** The body is the part after the first empty line. */
function bodyOf(raw: Buffer): Buffer {
  const at = raw.indexOf("\r\n\r\n");
  return at === -1 ? Buffer.alloc(0) : raw.subarray(at + 4);
}

function headerLinesOf(raw: Buffer): string[] {
  const at = raw.indexOf("\r\n\r\n");
  return raw
    .subarray(0, at === -1 ? raw.length : at)
    .toString("latin1")
    .split("\r\n");
}

/** Runs the same cases on every `MailSender` (the fake and each adapter). Architecture review §3.7. */
export function runMailSenderContract(
  name: string,
  makeHarness: () => Promise<MailSenderHarness>,
  options: MailSenderContractOptions = {}
): void {
  describe(`MailSender contract: ${name}`, () => {
    const opened: MailSender[] = [];

    async function setup(): Promise<{ harness: MailSenderHarness; sender: MailSender; b: string; c: string }> {
      const harness = await makeHarness();
      const { b, c } = harness.recipients?.() ?? { b: "b@x.test", c: "c@x.test" };
      const sender = await harness.open({ from: FROM });
      opened.push(sender);
      return { harness, sender, b, c };
    }

    afterEach(async () => {
      for (const sender of opened.splice(0)) await sender.close().catch(() => undefined);
    });

    test("send of a 1 KB message to one recipient: accepted lists it, rejected is empty", async () => {
      const { sender, b } = await setup();
      const message = testMessage([b]);
      expect(message.raw.length).toBeGreaterThanOrEqual(1000);
      const result = await sender.send({ envelope: { from: FROM, to: [b] }, raw: message.raw });
      expect(result.accepted).toEqual([b]);
      expect(result.rejected).toEqual([]);
    });

    test("the server gets the Message-ID, the X-EA-Action-Id and the body unchanged", async () => {
      const { harness, sender, b } = await setup();
      const message = testMessage([b]);
      await sender.send({ envelope: { from: FROM, to: [b] }, raw: message.raw });
      const got = await harness.received(message.messageId);
      if (got === null) throw new Error("the server has no mail with this Message-ID");
      const lines = headerLinesOf(got);
      expect(lines).toContain(`Message-ID: ${message.messageId}`);
      expect(lines).toContain(`X-EA-Action-Id: ${message.actionId}`);
      // A server may drop the last line break of the stored mail (GreenMail does); the text before it must be the same.
      expect(sha256(bodyOf(got).toString("latin1").trimEnd())).toBe(sha256(message.body.trimEnd()));
    });

    test("two recipients are both accepted", async () => {
      const { sender, b, c } = await setup();
      const message = testMessage([b, c]);
      const result = await sender.send({ envelope: { from: FROM, to: [b, c] }, raw: message.raw });
      expect([...result.accepted].sort()).toEqual([b, c].sort());
      expect(result.rejected).toEqual([]);
    });

    test("close twice does not throw; send after close rejects", async () => {
      const { sender, b } = await setup();
      await sender.close();
      await sender.close();
      const message = testMessage([b]);
      await expect(sender.send({ envelope: { from: FROM, to: [b] }, raw: message.raw })).rejects.toBeInstanceOf(Error);
    });

    // A refused login is a `MailAuthError`, at the open or at the first send (the adapter documents which).
    // `send.ts` turns only `MailAuthError` into the `auth_error` outcome.
    if (options.noRefusal !== undefined) {
      test.skip(`a refused login rejects with MailAuthError (skipped: ${options.noRefusal})`, () => undefined);
    } else {
      test("a refused login rejects with MailAuthError", async () => {
        const harness = await makeHarness();
        if (harness.openRefused === undefined) throw new Error("the harness has no openRefused");
        const refused = await harness.openRefused({ from: FROM });
        if (refused instanceof Error) {
          expect(refused).toBeInstanceOf(MailAuthError);
          return;
        }
        opened.push(refused);
        const message = testMessage(["b@x.test"]);
        await expect(
          refused.send({ envelope: { from: FROM, to: ["b@x.test"] }, raw: message.raw })
        ).rejects.toBeInstanceOf(MailAuthError);
      });
    }
  });
}
