import { describe, expect, test } from "bun:test";

import { SmtpSendError } from "../port";

import { createFakeMailSender } from "./sender";

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
});
