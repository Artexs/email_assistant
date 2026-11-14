import { describe, expect, test } from "bun:test";

import type { LookupAll, MailHostPolicy } from "./host-guard";
import { checkMailboxHosts } from "./host-status";

const BOX = { imap_host: "imap.x.test", smtp_host: "smtp.x.test" };

function policyOf(answer: (host: string) => string, allowLocal = false): { policy: MailHostPolicy; calls: string[] } {
  const calls: string[] = [];
  const lookup: LookupAll = async (host) => {
    calls.push(host);
    return [{ address: answer(host), family: 4 }];
  };
  return { policy: { allowLocal, lookup }, calls };
}

describe("checkMailboxHosts", () => {
  test("checks IMAP first, then SMTP, and reports each host", async () => {
    const { policy, calls } = policyOf((host) => (host === "imap.x.test" ? "93.184.216.34" : "10.0.0.7"));
    expect(await checkMailboxHosts(BOX, policy)).toEqual({ imap: "allowed", smtp: "refused" });
    expect(calls).toEqual(["imap.x.test", "smtp.x.test"]);
  });

  test("a failed lookup is lookup_failed, not refused", async () => {
    const lookup: LookupAll = async () => {
      throw Object.assign(new Error("getaddrinfo ENOTFOUND imap.x.test"), { code: "ENOTFOUND" });
    };
    expect(await checkMailboxHosts(BOX, { allowLocal: false, lookup })).toEqual({
      imap: "lookup_failed",
      smtp: "lookup_failed",
    });
  });

  test("allowLocal allows both hosts without a lookup", async () => {
    const { policy, calls } = policyOf(() => "10.0.0.7", true);
    expect(await checkMailboxHosts(BOX, policy)).toEqual({ imap: "allowed", smtp: "allowed" });
    expect(calls).toEqual([]);
  });

  test("a local literal host is refused without a lookup", async () => {
    const { policy, calls } = policyOf(() => "93.184.216.34");
    expect(await checkMailboxHosts({ imap_host: "127.0.0.1", smtp_host: "127.0.0.1" }, policy)).toEqual({
      imap: "refused",
      smtp: "refused",
    });
    expect(calls).toEqual([]);
  });
});
