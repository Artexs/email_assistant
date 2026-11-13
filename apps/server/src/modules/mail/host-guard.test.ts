import { describe, expect, test } from "bun:test";

import { SoftError } from "../../platform/errors";

import {
  configureMailHosts,
  DEFAULT_MAIL_HOST_POLICY,
  mailHostPolicy,
  resolveMailHost,
  type LookupAll,
  type MailHostPolicy,
} from "./host-guard";
import { HostNotAllowedError } from "./port";

function fake(answer: { address: string; family: number }[]): { policy: MailHostPolicy; calls: string[] } {
  const calls: string[] = [];
  const lookup: LookupAll = async (host) => {
    calls.push(host);
    return answer;
  };
  return { policy: { allowLocal: false, lookup }, calls };
}

const PUBLIC = { address: "93.184.216.34", family: 4 };

describe("resolveMailHost", () => {
  test("returns the resolved address with the name as servername", async () => {
    const { policy } = fake([PUBLIC]);
    expect(await resolveMailHost("imap.x.test", policy)).toEqual({ host: "93.184.216.34", servername: "imap.x.test" });
    expect(await resolveMailHost("imap.x.test.", policy)).toEqual({ host: "93.184.216.34", servername: "imap.x.test" });
  });

  test("refuses a name with one local address among public ones", async () => {
    const { policy } = fake([
      { address: "8.8.8.8", family: 4 },
      { address: "10.0.0.5", family: 4 },
    ]);
    await expect(resolveMailHost("imap.x.test", policy)).rejects.toBeInstanceOf(HostNotAllowedError);
  });

  test("refuses a Tailscale address", async () => {
    const { policy } = fake([{ address: "100.64.1.2", family: 4 }]);
    await expect(resolveMailHost("imap.x.test", policy)).rejects.toBeInstanceOf(HostNotAllowedError);
  });

  test("refuses a rebound second answer", async () => {
    let call = 0;
    const policy: MailHostPolicy = {
      allowLocal: false,
      lookup: async () => {
        call += 1;
        return [{ address: call === 1 ? "93.184.216.34" : "127.0.0.1", family: 4 }];
      },
    };
    expect((await resolveMailHost("imap.x.test", policy)).host).toBe("93.184.216.34");
    await expect(resolveMailHost("imap.x.test", policy)).rejects.toBeInstanceOf(HostNotAllowedError);
  });

  test("refuses a local name or literal without a lookup, and passes a public literal without one", async () => {
    const { policy, calls } = fake([PUBLIC]);
    for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
      await expect(resolveMailHost(host, policy)).rejects.toBeInstanceOf(HostNotAllowedError);
    }
    expect(await resolveMailHost("93.184.216.34", policy)).toEqual({ host: "93.184.216.34" });
    expect(calls).toEqual([]);
  });

  test("a failed lookup is a SoftError without the host name", async () => {
    const policy: MailHostPolicy = {
      allowLocal: false,
      lookup: async () => {
        throw Object.assign(new Error("getaddrinfo ENOTFOUND imap.x.test"), { code: "ENOTFOUND" });
      },
    };
    const error = await resolveMailHost("imap.x.test", policy).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SoftError);
    expect((error as Error).message).toBe("mail host lookup failed (ENOTFOUND)");
    expect((error as Error).message).not.toContain("x.test");
  });

  test("no address is a SoftError", async () => {
    const { policy } = fake([]);
    await expect(resolveMailHost("imap.x.test", policy)).rejects.toThrow("mail host lookup failed (ENODATA)");
  });

  test("allowLocal skips every check", async () => {
    const { policy, calls } = fake([PUBLIC]);
    expect(await resolveMailHost("localhost", { ...policy, allowLocal: true })).toEqual({ host: "localhost" });
    expect(calls).toEqual([]);
  });

  test("a write to the default policy throws and changes nothing", () => {
    const writable = DEFAULT_MAIL_HOST_POLICY as { allowLocal: boolean };
    expect(() => {
      writable.allowLocal = true;
    }).toThrow();
    expect(DEFAULT_MAIL_HOST_POLICY.allowLocal).toBe(false);
  });

  test("the process policy is strict by default and configurable", () => {
    expect(DEFAULT_MAIL_HOST_POLICY.allowLocal).toBe(false);
    expect(Object.isFrozen(DEFAULT_MAIL_HOST_POLICY)).toBe(true);
    const previous = mailHostPolicy();
    try {
      configureMailHosts({ allowLocal: true });
      expect(mailHostPolicy().allowLocal).toBe(true);
    } finally {
      configureMailHosts({ allowLocal: previous.allowLocal, lookup: previous.lookup });
    }
    expect(mailHostPolicy().allowLocal).toBe(previous.allowLocal);
  });

  test("prefers the first IPv4 address, else the first address", async () => {
    const v6 = { address: "2001:4860:4860::8888", family: 6 };
    expect(await resolveMailHost("imap.x.test", fake([v6, PUBLIC]).policy)).toEqual({
      host: "93.184.216.34",
      servername: "imap.x.test",
    });
    expect(await resolveMailHost("imap.x.test", fake([v6]).policy)).toEqual({
      host: "2001:4860:4860::8888",
      servername: "imap.x.test",
    });
  });
});
