import { describe, expect, test } from "bun:test";

import { runMailSenderContract } from "../../../../test/contract/mail-sender";
import { MailAuthError, SmtpSendError } from "../port";

import { createFakeMailSender, type FakeMailSender } from "./sender";

runMailSenderContract("fake", async () => {
  let sender: FakeMailSender | undefined;
  return {
    async open() {
      sender = createFakeMailSender();
      return sender;
    },
    async received(messageId) {
      return sender?.sent.find((mail) => mail.raw.includes(messageId))?.raw ?? null;
    },
    // The fake refuses at the first send.
    async openRefused() {
      const refused = createFakeMailSender();
      refused.failNext(new MailAuthError("SMTP login failed"));
      return refused;
    },
  };
});

const input = { envelope: { from: "me@x.test", to: ["a@x.test", "b@x.test"] }, raw: Buffer.from("raw") };

describe("createFakeMailSender", () => {
  test("records a send and answers 250", async () => {
    const sender = createFakeMailSender();
    const result = await sender.send(input);
    expect(result).toEqual({
      response: "250 2.0.0 Ok: queued as FAKE",
      accepted: ["a@x.test", "b@x.test"],
      rejected: [],
    });
    expect(sender.sent).toEqual([input]);
    expect(sender.calls).toEqual(["send"]);
  });

  test("failNext throws the given error for the given number of calls, then recovers", async () => {
    const sender = createFakeMailSender();
    const error = new SmtpSendError("unknown", "ECONNECTION", null, false, true);
    sender.failNext(error, 2);
    await expect(sender.send(input)).rejects.toBe(error);
    await expect(sender.send(input)).rejects.toBe(error);
    expect(sender.sent).toHaveLength(0);
    await sender.send(input);
    expect(sender.sent).toHaveLength(1);
    expect(sender.calls).toEqual(["send", "send", "send"]);
  });

  test("close sets the flag", async () => {
    const sender = createFakeMailSender();
    await sender.close();
    expect(sender.closed).toBe(true);
  });

  test("a sender that is closed refuses a send with stage connect and sends nothing", async () => {
    const sender = createFakeMailSender();
    await sender.close();
    await expect(sender.send(input)).rejects.toMatchObject({
      name: "SmtpSendError",
      stage: "connect",
      code: "ECLOSED",
    });
    expect(sender.sent).toHaveLength(0);
  });
});
