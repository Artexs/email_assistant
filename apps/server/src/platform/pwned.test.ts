import { createHash } from "node:crypto";

import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";

import { checkPwnedPassword, PWNED_RANGE_URL } from "./pwned";

const sha1 = (text: string) => createHash("sha1").update(text, "utf8").digest("hex").toUpperCase();

const LISTED = "password1234";
const GOOD = "correct-horse-battery-staple";
const LISTED_HASH = sha1(LISTED);
const GOOD_HASH = sha1(GOOD);

const lines: string[] = [];
let spies: ReturnType<typeof spyOn>[] = [];

beforeAll(() => {
  const capture = (...args: unknown[]): void => {
    lines.push(args.map(String).join(" "));
  };
  spies = [
    spyOn(console, "log").mockImplementation(capture),
    spyOn(console, "error").mockImplementation(capture),
    spyOn(console, "warn").mockImplementation(capture),
  ];
});

afterAll(() => {
  for (const spy of spies) spy.mockRestore();
});

interface Seen {
  url: string;
  headers: Headers;
}

function fakeFetch(body: string, status = 200) {
  const seen: Seen[] = [];
  const fake = (async (input: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(input), headers: new Headers(init?.headers) });
    return new Response(body, { status });
  }) as typeof fetch;
  return { fake, seen };
}

const rangeBody = `${LISTED_HASH.slice(5)}:443397\r\nFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:0\r\n`;

describe("checkPwnedPassword", () => {
  test("a listed password is pwned; the request holds the 5-character prefix and the padding header", async () => {
    const { fake, seen } = fakeFetch(rangeBody);
    expect(await checkPwnedPassword(LISTED, { fetch: fake, timeoutMs: 1000 })).toBe("pwned");
    expect(LISTED_HASH.slice(0, 5)).toBe("E6B6A");
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe(`${PWNED_RANGE_URL}E6B6A`);
    expect(seen[0]?.headers.get("add-padding")).toBe("true");
    expect(seen[0]?.headers.get("user-agent")).toBe("email-assistant");
  });

  test("a password whose suffix is not in the body is ok", async () => {
    const { fake, seen } = fakeFetch(rangeBody);
    expect(await checkPwnedPassword(GOOD, { fetch: fake, timeoutMs: 1000 })).toBe("ok");
    expect(GOOD_HASH.slice(0, 5)).toBe("DD606");
    expect(seen[0]?.url).toBe(`${PWNED_RANGE_URL}DD606`);
  });

  test("a line with the right suffix and count 0 (padding) is ok", async () => {
    const { fake } = fakeFetch(`${GOOD_HASH.slice(5)}:0\r\n`);
    expect(await checkPwnedPassword(GOOD, { fetch: fake, timeoutMs: 1000 })).toBe("ok");
  });

  test("a lower-case suffix and bare line breaks still match", async () => {
    const { fake } = fakeFetch(`AAAA:1\n${LISTED_HASH.slice(5).toLowerCase()}:7\nBBBB:2`);
    expect(await checkPwnedPassword(LISTED, { fetch: fake, timeoutMs: 1000 })).toBe("pwned");
  });

  test("status 503, a rejected fetch and a timeout are unavailable", async () => {
    const down = fakeFetch("", 503);
    expect(await checkPwnedPassword(LISTED, { fetch: down.fake, timeoutMs: 1000 })).toBe("unavailable");

    const rejecting = (async () => {
      throw new TypeError("connection refused");
    }) as unknown as typeof fetch;
    expect(await checkPwnedPassword(LISTED, { fetch: rejecting, timeoutMs: 1000 })).toBe("unavailable");

    const waiting = ((_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      })) as typeof fetch;
    const started = performance.now();
    expect(await checkPwnedPassword(LISTED, { fetch: waiting, timeoutMs: 50 })).toBe("unavailable");
    expect(performance.now() - started).toBeLessThan(1000);
  });

  test("the log of the cases above holds no password, no prefix and no hash", () => {
    expect(lines.some((line) => line.includes("pwned check unavailable"))).toBe(true);
    expect(lines.some((line) => line.includes("status 503"))).toBe(true);
    expect(lines.some((line) => line.includes("TimeoutError"))).toBe(true);
    for (const line of lines) {
      for (const secret of [LISTED, GOOD, LISTED_HASH, GOOD_HASH, "E6B6A", "DD606", LISTED_HASH.slice(5)]) {
        expect(line.toUpperCase()).not.toContain(secret.toUpperCase());
      }
    }
  });
});
