import { describe, expect, test } from "bun:test";

import { isLoopbackApiRoot } from "./loopback";

describe("isLoopbackApiRoot", () => {
  test.each(["http://127.0.0.1:8090", "http://localhost:8090", "http://[::1]:8090", "https://127.0.0.1"])(
    "accepts %s",
    (value) => expect(isLoopbackApiRoot(value)).toBe(true)
  );

  test.each([
    "https://api.telegram.org",
    "http://10.0.0.5:8090",
    "http://127.0.0.1@evil.test",
    "http://127.0.0.1:8090/",
    "http://127.0.0.1:8090/bot",
    "ftp://127.0.0.1",
    "127.0.0.1:8090",
    "http://0.0.0.0:8090",
    "",
  ])("rejects %j", (value) => expect(isLoopbackApiRoot(value)).toBe(false));
});
