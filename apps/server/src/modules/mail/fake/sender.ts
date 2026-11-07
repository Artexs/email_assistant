import type { MailSender } from "../port";

export interface FakeMailSender extends MailSender {
  readonly sent: { envelope: { from: string; to: string[] }; raw: Buffer }[];
  readonly calls: string[];
  closed: boolean;
  /** The next `times` calls (default 1) throw `error` and record nothing in `sent`. */
  failNext(error: Error, times?: number): void;
}

export function createFakeMailSender(): FakeMailSender {
  const sent: FakeMailSender["sent"] = [];
  const calls: string[] = [];
  const failures: Error[] = [];
  const sender: FakeMailSender = {
    sent,
    calls,
    closed: false,
    failNext(error, times = 1) {
      for (let i = 0; i < times; i += 1) failures.push(error);
    },
    async send(input) {
      calls.push("send");
      const failure = failures.shift();
      if (failure !== undefined) throw failure;
      sent.push({ envelope: { from: input.envelope.from, to: [...input.envelope.to] }, raw: input.raw });
      return { response: "250 2.0.0 Ok: queued as FAKE", accepted: [...input.envelope.to], rejected: [] };
    },
    async close() {
      calls.push("close");
      sender.closed = true;
    },
  };
  return sender;
}
