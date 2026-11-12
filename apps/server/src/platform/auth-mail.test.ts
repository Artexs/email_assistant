import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import {
  type AuthMail,
  authMailErrorCode,
  authMailTransportOptions,
  type AuthMailerDeps,
  createAuthMailer,
  createAuthMailTasks,
} from "./auth-mail";
import { type AuthMailKind, authMailText } from "./auth-mail-texts";
import type { AuthMailSettings } from "./config";

const settings: AuthMailSettings = {
  host: "smtp.x.test",
  port: 465,
  security: "tls",
  user: "u",
  password: "p",
  from: "noreply@x.test",
};
const LINK = "https://x.test/link";
const mail: AuthMail = { kind: "reset", userId: "user-1", to: "who@x.test", locale: "en", url: LINK };

describe("authMailTransportOptions", () => {
  test("a loopback host connects without TLS", () => {
    const options = authMailTransportOptions({ ...settings, host: "127.0.0.1" }, 1234);
    expect(options.secure).toBe(false);
    expect(options.ignoreTLS).toBe(true);
  });

  test("tls is implicit TLS; starttls requires TLS", () => {
    expect(authMailTransportOptions(settings, 1234).secure).toBe(true);
    const starttls = authMailTransportOptions({ ...settings, security: "starttls" }, 1234);
    expect(starttls.secure).toBe(false);
    expect(starttls.requireTLS).toBe(true);
  });

  test("no result has a tls key; the three timeouts equal the argument", () => {
    for (const host of ["127.0.0.1", "localhost", "::1", "smtp.x.test"]) {
      for (const security of ["tls", "starttls"] as const) {
        const options = authMailTransportOptions({ ...settings, host, security }, 1234);
        expect("tls" in options).toBe(false);
        expect([options.connectionTimeout, options.greetingTimeout, options.socketTimeout]).toEqual([1234, 1234, 1234]);
      }
    }
  });
});

test("authMailErrorCode keeps a plain code and hides the rest", () => {
  expect(authMailErrorCode({ code: "EAUTH" })).toBe("EAUTH");
  expect(authMailErrorCode({ code: "weird code" })).toBe("UNKNOWN");
  expect(authMailErrorCode(new Error("x"))).toBe("UNKNOWN");
  expect(authMailErrorCode(null)).toBe("UNKNOWN");
});

describe("authMailText", () => {
  const subjects: Record<AuthMailKind, Record<"en" | "pl", string>> = {
    invite: { en: "Your Email Assistant account", pl: "Twoje konto w Email Assistant" },
    reset: { en: "Reset your Email Assistant password", pl: "Zmiana hasła w Email Assistant" },
    lockout: {
      en: "Your Email Assistant account is locked for 15 minutes",
      pl: "Konto w Email Assistant zablokowane na 15 minut",
    },
  };

  for (const kind of ["invite", "reset", "lockout"] as const) {
    for (const locale of ["en", "pl"] as const) {
      test(`${kind} / ${locale}: the link once, the subject as written`, () => {
        const { subject, text } = authMailText(kind, locale, LINK);
        expect(subject).toBe(subjects[kind][locale]);
        expect(text.split(LINK)).toHaveLength(2);
        expect(text).not.toContain("{url}");
      });
    }
  }
});

describe("createAuthMailer", () => {
  let lines: { level: "log" | "error"; text: string }[] = [];
  let logSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    lines = [];
    logSpy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push({ level: "log", text: args.join(" ") });
    });
    errorSpy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      lines.push({ level: "error", text: args.join(" ") });
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  test("a send that never settles gives TIMEOUT and closes the transport", async () => {
    let closed = 0;
    const deps: AuthMailerDeps = {
      timeoutMs: 50,
      createTransport: () => ({
        sendMail: () => new Promise<unknown>(() => undefined),
        close: () => {
          closed += 1;
        },
      }),
    };
    const started = performance.now();
    const result = await createAuthMailer(settings, deps).send(mail);
    expect(result).toEqual({ ok: false, code: "TIMEOUT" });
    expect(performance.now() - started).toBeLessThan(6000);
    expect(closed).toBe(1);
  }, 10_000);

  test("a failed send gives the code; the log holds the user id and the code only", async () => {
    let closed = 0;
    const deps: AuthMailerDeps = {
      createTransport: () => ({
        sendMail: () => Promise.reject({ code: "EAUTH", message: `secret ${LINK}` }),
        close: () => {
          closed += 1;
        },
      }),
    };
    const result = await createAuthMailer(settings, deps).send(mail);
    expect(result).toEqual({ ok: false, code: "EAUTH" });
    expect(closed).toBe(1);
    const warns = lines.filter((line) => line.level === "error");
    expect(warns).toHaveLength(1);
    expect(warns[0]?.text).toContain("user-1");
    expect(warns[0]?.text).toContain("EAUTH");
    expect(lines.some((line) => line.text.includes("x.test") || line.text.includes("secret"))).toBe(false);
  });

  test("a throwing transport factory still gives a result", async () => {
    const mailer = createAuthMailer(settings, {
      createTransport: () => {
        throw new Error("boom");
      },
    });
    expect(await mailer.send(mail)).toEqual({ ok: false, code: "UNKNOWN" });
  });

  test("a sent mail gives ok, with the message and the sender passed to the transport", async () => {
    const messages: object[] = [];
    const mailer = createAuthMailer(settings, {
      createTransport: () => ({
        sendMail: (message) => {
          messages.push(message);
          return Promise.resolve({});
        },
        close: () => undefined,
      }),
    });
    expect(await mailer.send(mail)).toEqual({ ok: true });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      from: { name: "Email Assistant", address: "noreply@x.test" },
      to: "who@x.test",
      subject: "Reset your Email Assistant password",
    });
    expect(lines.some((line) => line.text.includes("x.test"))).toBe(false);
  });
});

describe("createAuthMailTasks", () => {
  const input = { kind: "reset", userId: "user-1", to: "who@x.test", url: LINK } as const;

  test("start returns at once; idle waits for the send; the mail gets the locale", async () => {
    const sent: AuthMail[] = [];
    const tasks = createAuthMailTasks({
      mailer: {
        send: async (m) => {
          await new Promise((resolve) => setTimeout(resolve, 50));
          sent.push(m);
          return { ok: true };
        },
      },
      localeOf: async () => "en",
      onFailed: () => undefined,
    });
    tasks.start(input);
    expect(sent).toHaveLength(0);
    await tasks.idle();
    expect(sent).toEqual([{ ...input, locale: "en" }]);
  });

  test("a failed locale read falls back to pl", async () => {
    const sent: AuthMail[] = [];
    const tasks = createAuthMailTasks({
      mailer: {
        send: async (m) => {
          sent.push(m);
          return { ok: true };
        },
      },
      localeOf: async () => {
        throw new Error("db down");
      },
      onFailed: () => undefined,
    });
    tasks.start(input);
    await tasks.idle();
    expect(sent[0]?.locale).toBe("pl");
  });

  test("a failed send calls onFailed once with the code", async () => {
    const failed: [string, string, string][] = [];
    const tasks = createAuthMailTasks({
      mailer: { send: async () => ({ ok: false, code: "EAUTH" }) },
      localeOf: async () => "pl",
      onFailed: (userId, kind, code) => failed.push([userId, kind, code]),
    });
    tasks.start(input);
    await tasks.idle();
    expect(failed).toEqual([["user-1", "reset", "EAUTH"]]);
  });

  test("a throwing mailer or callback never rejects and logs no address", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation((): void => undefined);
    try {
      const tasks = createAuthMailTasks({
        mailer: {
          send: async () => {
            throw new Error("boom");
          },
        },
        localeOf: async () => "pl",
        onFailed: () => undefined,
      });
      tasks.start(input);
      await tasks.idle();
      const text = errorSpy.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(text).toContain("user-1");
      expect(text).not.toContain("who@x.test");
      expect(text).not.toContain(LINK);
    } finally {
      errorSpy.mockRestore();
    }
  });
});
