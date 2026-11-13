import { describe, expect, test } from "bun:test";

import { isLocalAddress, isLocalMailHost } from "./host-check";

describe("isLocalMailHost", () => {
  test.each([
    "localhost",
    "LOCALHOST",
    "mail.localhost",
    "localhost.",
    "localhost..",
    "LocalHost.",
    "mail.localhost.",
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

describe("isLocalAddress", () => {
  test.each([
    "100.64.0.1",
    "100.127.255.255",
    "198.18.0.1",
    "198.19.255.255",
    "192.0.0.8",
    "::ffff:100.64.0.1",
    "224.0.0.0", // multicast
    "239.255.255.255",
    "240.0.0.1", // reserved
    "247.1.2.3",
    "255.255.255.254",
    "255.255.255.255", // broadcast
    "::ffff:224.0.0.1",
    "ff00::1", // multicast
    "ff02::1",
    "ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
    "64:ff9b::1", // NAT64
    "64:ff9b::808:808",
    "64:ff9b::ffff:ffff",
    "fec0::1", // site-local
    "febf:ffff::1", // just below site-local: link-local, refused by fe80::/10
    "feff:ffff::1",
    "2002::1", // 6to4
    "2002:808:808::1",
    "2002:ffff:ffff::1",
    "127.0.0.1",
    "10.1.2.3",
    "fe80::1",
    "not-an-ip",
  ])("refuses %s", (ip) => {
    expect(isLocalAddress(ip)).toBe(true);
  });

  test.each([
    "100.128.0.1",
    "198.20.0.1",
    "192.0.1.1",
    "8.8.8.8",
    "2001:4860:4860::8888",
    "223.255.255.255", // below multicast
    "64:ff9a:ffff:ffff:ffff:ffff:ffff:ffff", // below NAT64
    "64:ff9b:1::1", // above NAT64
    "2001:ffff:ffff::1", // below 6to4
    "2003::1", // above 6to4
  ])("allows %s", (ip) => {
    expect(isLocalAddress(ip)).toBe(false);
  });

  test("isLocalMailHost refuses a Tailscale literal", () => {
    expect(isLocalMailHost("100.64.0.1")).toBe(true);
  });
});
