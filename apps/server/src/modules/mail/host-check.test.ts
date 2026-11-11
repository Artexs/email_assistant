import { describe, expect, test } from "bun:test";

import { isLocalMailHost } from "./host-check";

describe("isLocalMailHost", () => {
  test.each([
    "localhost",
    "LOCALHOST",
    "mail.localhost",
    "127.0.0.1",
    "127.8.9.1",
    "0.0.0.0",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.10",
    "169.254.1.1",
    "::1",
    "[::1]",
    "fd00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "::ffff:192.168.0.1",
    "::ffff:7f00:1",
    "::",
    "127.1",
    "0",
    "2130706433",
    "0x7f.1",
    "0x7f000001",
  ])("%s is local", (host) => {
    expect(isLocalMailHost(host)).toBe(true);
  });

  test.each(["poczta.interia.pl", "imap.gmail.com", "8.8.8.8", "172.32.0.1", "2001:db8::1", "localhost.example.com"])(
    "%s is public",
    (host) => {
      expect(isLocalMailHost(host)).toBe(false);
    }
  );
});
