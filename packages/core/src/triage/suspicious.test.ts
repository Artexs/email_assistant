import { describe, expect, test } from "bun:test";

import {
  assessSuspicious,
  freeMailDomains,
  isLookalike,
  isSharedHostingDomain,
  registrableDomain,
  registrableDomainShared,
  suspiciousReasons,
  type SuspiciousInput,
} from "./suspicious";

// A quiet mail: no rule fires. Each test changes only what it needs.
function input(overrides: Partial<SuspiciousInput> = {}): SuspiciousInput {
  return {
    fromAddress: "billing@shop.test",
    fromName: null,
    replyTo: [],
    authResults: null,
    trustedAuthservIds: [],
    links: [],
    attachments: [],
    isList: false,
    senderKnown: false,
    knownDomains: [],
    protectedNames: [],
    ...overrides,
  };
}

describe("assessSuspicious: quiet mail", () => {
  test("a mail with nothing odd gives no reason", () => {
    expect(assessSuspicious(input())).toEqual([]);
  });
});

describe("lookalike_domain", () => {
  const lookalike = { fromAddress: "billing@paliwa-fiota.test", knownDomains: ["paliwa-flota.test"] };

  test("1: one letter changed, unknown sender", () => {
    expect(assessSuspicious(input(lookalike))).toEqual(["lookalike_domain"]);
  });

  test("2: the same mail from a known sender gives nothing", () => {
    expect(assessSuspicious(input({ ...lookalike, senderKnown: true }))).toEqual([]);
  });

  test("3: labels under 5 characters are not compared by distance", () => {
    expect(assessSuspicious(input({ fromAddress: "a@abc.test", knownDomains: ["abd.test"] }))).toEqual([]);
  });

  test("4: an xn-- domain with a Cyrillic letter matches the Latin domain", () => {
    const hostname = new URL("http://pаypal.test").hostname; // Cyrillic "а"
    expect(hostname.startsWith("xn--")).toBe(true);
    expect(registrableDomain(hostname)).toBe("pаypal.test");
    expect(assessSuspicious(input({ fromAddress: `a@${hostname}`, knownDomains: ["paypal.test"] }))).toEqual([
      "lookalike_domain",
    ]);
  });

  test("a short label is caught by the skeleton only: Cyrillic letter, and 1 for l", () => {
    const hostname = new URL("http://bаnk.test").hostname; // Cyrillic "а", 4-letter label
    expect(assessSuspicious(input({ fromAddress: `a@${hostname}`, knownDomains: ["bank.test"] }))).toEqual([
      "lookalike_domain",
    ]);
    expect(assessSuspicious(input({ fromAddress: "a@1ogo.test", knownDomains: ["logo.test"] }))).toEqual([
      "lookalike_domain",
    ]);
  });

  test("the known domain itself, and its subdomain, are not look-alikes", () => {
    const known = { knownDomains: ["paliwa-flota.test"] };
    expect(assessSuspicious(input({ ...known, fromAddress: "a@paliwa-flota.test" }))).toEqual([]);
    expect(assessSuspicious(input({ ...known, fromAddress: "a@mail.paliwa-flota.test" }))).toEqual([]);
  });

  test("rn looks like m, 0 like o, 1 like l", () => {
    expect(assessSuspicious(input({ fromAddress: "a@rnicrosoft.test", knownDomains: ["microsoft.test"] }))).toEqual([
      "lookalike_domain",
    ]);
    expect(assessSuspicious(input({ fromAddress: "a@g00gle.test", knownDomains: ["google.test"] }))).toEqual([
      "lookalike_domain",
    ]);
  });

  test("two letters changed is not a look-alike", () => {
    expect(assessSuspicious(input({ fromAddress: "a@kordelan.test", knownDomains: ["kordelxy.test"] }))).toEqual([]);
  });

  test("a swapped pair of letters is distance 1", () => {
    expect(
      assessSuspicious(input({ fromAddress: "a@paliwa-flota.test", knownDomains: ["paliwa-folta.test"] }))
    ).toEqual(["lookalike_domain"]);
  });

  test("no known domains gives nothing", () => {
    expect(assessSuspicious(input({ fromAddress: "a@paliwa-fiota.test" }))).toEqual([]);
  });
});

describe("auth_fail", () => {
  const fail = "mx.interia.pl; dmarc=fail header.from=x.test";

  test("5a: a trusted authserv-id and dmarc=fail", () => {
    expect(assessSuspicious(input({ authResults: fail, trustedAuthservIds: ["interia.pl"] }))).toEqual(["auth_fail"]);
  });

  test("5b: no trusted id gives nothing", () => {
    expect(assessSuspicious(input({ authResults: fail, trustedAuthservIds: [] }))).toEqual([]);
  });

  test("5c: spf=fail alone gives nothing", () => {
    const authResults = "mx.interia.pl; spf=fail smtp.mailfrom=x.test; dkim=pass header.d=x.test";
    expect(assessSuspicious(input({ authResults, trustedAuthservIds: ["interia.pl"] }))).toEqual([]);
  });

  test("5d: spf=fail and dkim=fail", () => {
    const authResults = "mx.interia.pl; spf=fail smtp.mailfrom=x.test; dkim=fail header.d=x.test";
    expect(assessSuspicious(input({ authResults, trustedAuthservIds: ["interia.pl"] }))).toEqual(["auth_fail"]);
  });

  test("a header from an untrusted authserv-id is ignored", () => {
    expect(
      assessSuspicious(input({ authResults: "evil.test; dmarc=fail", trustedAuthservIds: ["interia.pl"] }))
    ).toEqual([]);
    expect(
      assessSuspicious(input({ authResults: "notinteria.pl; dmarc=fail", trustedAuthservIds: ["interia.pl"] }))
    ).toEqual([]);
  });

  test("the authserv-id may equal the trusted entry, in any case", () => {
    expect(
      assessSuspicious(input({ authResults: "Interia.PL; DMARC=FAIL", trustedAuthservIds: ["interia.pl"] }))
    ).toEqual(["auth_fail"]);
  });

  test("dmarc=pass gives nothing; no header gives nothing", () => {
    expect(
      assessSuspicious(input({ authResults: "mx.interia.pl; dmarc=pass", trustedAuthservIds: ["interia.pl"] }))
    ).toEqual([]);
    expect(assessSuspicious(input({ authResults: null, trustedAuthservIds: ["interia.pl"] }))).toEqual([]);
  });

  test("a known sender still gets auth_fail", () => {
    expect(
      assessSuspicious(input({ authResults: fail, trustedAuthservIds: ["interia.pl"], senderKnown: true }))
    ).toEqual(["auth_fail"]);
  });
});

describe("display_name_spoof", () => {
  test("6a: an address in the name that differs from the sender address", () => {
    expect(assessSuspicious(input({ fromAddress: "x@evil.test", fromName: "Jan Kowalski <ceo@corp.test>" }))).toEqual([
      "display_name_spoof",
    ]);
  });

  test("6b: a protected name with two words", () => {
    const protectedNames = ["Jan Kowalski"];
    expect(assessSuspicious(input({ fromName: "Jan Kowalski", protectedNames }))).toEqual(["display_name_spoof"]);
    expect(assessSuspicious(input({ fromName: "JAN  Kowalskí", protectedNames }))).toEqual(["display_name_spoof"]);
  });

  test("6c: a one-word protected name gives nothing", () => {
    expect(assessSuspicious(input({ fromName: "Jan", protectedNames: ["Jan"] }))).toEqual([]);
  });

  test("the sender's own address in the name is no spoof", () => {
    expect(assessSuspicious(input({ fromAddress: "x@shop.test", fromName: "x@shop.test" }))).toEqual([]);
  });

  test("a known sender gets no display_name_spoof", () => {
    expect(
      assessSuspicious(input({ fromName: "Jan Kowalski", protectedNames: ["Jan Kowalski"], senderKnown: true }))
    ).toEqual([]);
  });
});

describe("reply_to_mismatch", () => {
  const mismatch = { fromAddress: "a@shop.test", replyTo: ["pay@other.test"] };

  test("7a: another registrable domain", () => {
    expect(assessSuspicious(input(mismatch))).toEqual(["reply_to_mismatch"]);
  });

  test("7b: list mail is exempt", () => {
    expect(assessSuspicious(input({ ...mismatch, isList: true }))).toEqual([]);
  });

  test("the same registrable domain, or a named address, is no mismatch", () => {
    expect(assessSuspicious(input({ fromAddress: "a@shop.test", replyTo: ["Pay <pay@mail.shop.test>"] }))).toEqual([]);
    expect(assessSuspicious(input({ fromAddress: "a@shop.test", replyTo: ["Pay <pay@other.test>"] }))).toEqual([
      "reply_to_mismatch",
    ]);
  });

  test("a known sender gets no reply_to_mismatch", () => {
    expect(assessSuspicious(input({ ...mismatch, senderKnown: true }))).toEqual([]);
  });
});

describe("link_mismatch", () => {
  test("8a: the shown host differs from the target host", () => {
    expect(assessSuspicious(input({ links: [{ host: "evil.test", textHost: "www.bank.test" }] }))).toEqual([
      "link_mismatch",
    ]);
  });

  test("8b: list mail is exempt", () => {
    expect(
      assessSuspicious(input({ links: [{ host: "evil.test", textHost: "www.bank.test" }], isList: true }))
    ).toEqual([]);
  });

  test("8c: same registrable domain under a two-level suffix", () => {
    expect(assessSuspicious(input({ links: [{ host: "news.shop.co.uk", textHost: "shop.co.uk" }] }))).toEqual([]);
  });

  test("a link without shown host gives nothing", () => {
    expect(assessSuspicious(input({ links: [{ host: "evil.test", textHost: null }] }))).toEqual([]);
  });

  test("a known sender gets no link_mismatch", () => {
    expect(
      assessSuspicious(input({ links: [{ host: "evil.test", textHost: "bank.test" }], senderKnown: true }))
    ).toEqual([]);
  });
});

describe("risky_attachment", () => {
  test("9a: a double extension ending in .exe, also for a known sender", () => {
    const attachments = [{ name: "faktura.pdf.exe", type: "application/octet-stream" }];
    expect(assessSuspicious(input({ attachments }))).toEqual(["risky_attachment"]);
    expect(assessSuspicious(input({ attachments, senderKnown: true }))).toEqual(["risky_attachment"]);
  });

  test("9b: a document gives nothing", () => {
    const type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    expect(assessSuspicious(input({ attachments: [{ name: "umowa.docx", type }] }))).toEqual([]);
  });

  test("a risky type with a harmless name, and a macro extension", () => {
    expect(assessSuspicious(input({ attachments: [{ name: null, type: "application/x-msdownload; x=y" }] }))).toEqual([
      "risky_attachment",
    ]);
    expect(assessSuspicious(input({ attachments: [{ name: "Budget.XLSM", type: "application/zip" }] }))).toEqual([
      "risky_attachment",
    ]);
  });

  test("a name without extension gives nothing", () => {
    expect(assessSuspicious(input({ attachments: [{ name: "exe", type: "text/plain" }] }))).toEqual([]);
  });
});

describe("registrableDomain", () => {
  test("10: the last two labels, three under a two-level suffix", () => {
    expect(registrableDomain("a.b.example.com.pl")).toBe("example.com.pl");
    expect(registrableDomain("mail.kordelan.test")).toBe("kordelan.test");
    expect(registrableDomain("localhost")).toBe("localhost");
  });

  test("folds case and a trailing dot", () => {
    expect(registrableDomain("WWW.Shop.CO.UK.")).toBe("shop.co.uk");
  });
});

describe("assessSuspicious: all rules", () => {
  test("11: six reasons come in list order, without duplicates", () => {
    const reasons = assessSuspicious({
      fromAddress: "x@paliwa-fiota.test",
      fromName: "Jan Kowalski <ceo@corp.test>",
      replyTo: ["pay@other.test", "pay2@other.test"],
      authResults: "mx.interia.pl; dmarc=fail",
      trustedAuthservIds: ["interia.pl"],
      links: [
        { host: "evil.test", textHost: "bank.test" },
        { host: "evil2.test", textHost: "bank2.test" },
      ],
      attachments: [
        { name: "a.exe", type: "application/octet-stream" },
        { name: "b.scr", type: "application/octet-stream" },
      ],
      isList: false,
      senderKnown: false,
      knownDomains: ["paliwa-flota.test"],
      protectedNames: ["Jan Kowalski"],
    });
    expect(reasons).toEqual([...suspiciousReasons]);
  });
});

describe("freeMailDomains", () => {
  test("lists the common free-mail domains", () => {
    for (const domain of ["gmail.com", "interia.pl", "wp.pl", "web.de", "protonmail.com"]) {
      expect(freeMailDomains).toContain(domain);
    }
  });
});

describe("sentDomains: look-alike targets that never exempt themselves", () => {
  test("a sender on a Sent domain is not exempt from the look-alike check against other targets", () => {
    expect(isLookalike("acmec0rp.pl", ["acmecorp.pl"], ["acmec0rp.pl"])).toBe(true);
    expect(isLookalike("acmec0rp.pl", [], ["acmec0rp.pl"])).toBe(false);
  });

  test("a Sent domain is a target for other senders; a base domain still exempts itself", () => {
    expect(isLookalike("kontrahemt.pl", [], ["kontrahent.pl"])).toBe(true);
    expect(isLookalike("kontrahent.pl", ["kontrahent.pl"], ["kontrahent.pl"])).toBe(false);
    expect(isLookalike("kontrahemt.pl", [], [])).toBe(false);
  });

  test("assessSuspicious reads sentDomains as targets, and without it as before", () => {
    const base = { fromAddress: "x@kontrahemt.pl" };
    expect(assessSuspicious(input({ ...base, sentDomains: ["kontrahent.pl"] }))).toEqual(["lookalike_domain"]);
    expect(assessSuspicious(input(base))).toEqual([]);
    expect(assessSuspicious(input({ fromAddress: "x@kontrahent.pl", sentDomains: ["kontrahent.pl"] }))).toEqual([]);
  });
});

describe("registrableDomainShared", () => {
  test("agrees with registrableDomain except for tenants of a shared hosting suffix", () => {
    for (const host of [
      "mail.kontrahent.pl",
      "a.b.firma.com.pl",
      "x.co.uk",
      "WWW.Example.COM",
      "xn--pypal-4ve.com",
      "pl",
    ]) {
      expect(registrableDomainShared(host)).toBe(registrableDomain(host));
    }
    expect(registrableDomainShared("a.b.someone.github.io")).toBe("someone.github.io");
    expect(registrableDomainShared("a.herokuapp.com")).toBe("a.herokuapp.com");
    expect(registrableDomainShared("b.herokuapp.com")).toBe("b.herokuapp.com");
    expect(registrableDomainShared("herokuapp.com")).toBe("herokuapp.com");
    expect(registrableDomain("a.herokuapp.com")).toBe("herokuapp.com");
  });
});

describe("freeMailDomains", () => {
  test("holds the common Polish and international free-mail domains", () => {
    for (const domain of [
      "vp.pl",
      "autograf.pl",
      "onet.eu",
      "yahoo.pl",
      "outlook.pl",
      "me.com",
      "aol.com",
      "msn.com",
      "mail.com",
      "pm.me",
      "proton.me",
      "protonmail.com",
      "tutanota.com",
      "zoho.com",
      "hotmail.co.uk",
      "yahoo.co.uk",
      "gmx.com",
      "gmx.net",
      "gmx.de",
      "web.de",
    ]) {
      expect(freeMailDomains).toContain(domain);
    }
  });
});

describe("isSharedHostingDomain", () => {
  test("a tenant host of a shared suffix counts; an ordinary or a two-level domain does not", () => {
    expect(isSharedHostingDomain("github.io")).toBe(true);
    expect(isSharedHostingDomain("someone.github.io")).toBe(true);
    expect(isSharedHostingDomain("app.herokuapp.com")).toBe(true);
    expect(isSharedHostingDomain("acme.pl")).toBe(false);
    expect(isSharedHostingDomain("mail.acme.com.pl")).toBe(false);
  });
});

describe("onmicrosoft.com is a shared hosting suffix", () => {
  test("the tenants stay apart and the suffix is shared", () => {
    expect(isSharedHostingDomain("evil1.onmicrosoft.com")).toBe(true);
    expect(isSharedHostingDomain("onmicrosoft.com")).toBe(true);
    expect(registrableDomainShared("evil1.onmicrosoft.com")).toBe("evil1.onmicrosoft.com");
    expect(registrableDomainShared("evil2.onmicrosoft.com")).not.toBe(registrableDomainShared("evil1.onmicrosoft.com"));
  });
});

describe("isLookalike: one edit apart", () => {
  test.each([
    ["an inserted letter", "amazoon.com", true],
    ["a deleted letter", "amazn.com", true],
    ["two substituted letters", "anazom.com", false],
    ["a length difference of 2", "amazonnn.com", false],
    ["the same label under another TLD", "amazon.net", false],
    ["an insertion with a different tail", "amaxonn.com", false],
    ["a swap with a different first letter", "xaazon.com", false],
    ["a swap with a different second letter", "mxazon.com", false],
    ["a swap with a different tail", "maxxon.com", false],
  ])("%s: %s", (_name, sender, expected) => {
    expect(isLookalike(sender, ["amazon.com"])).toBe(expected);
  });

  test.each([
    ["4 letters on both sides are too short", "abcf.com", "abcd.com", false],
    ["5 letters on both sides are compared", "abcdf.com", "abcde.com", true],
    ["a 4 letter sender against a 5 letter known domain", "abcd.com", "abcde.com", false],
    ["a 5 letter sender against a 4 letter known domain", "abcde.com", "abcd.com", false],
  ])("%s", (_name, sender, known, expected) => {
    expect(isLookalike(sender, [known])).toBe(expected);
  });

  test("a sender on the known list is not flagged against another known domain", () => {
    expect(isLookalike("amazon.com", ["amazon.com", "amazom.com"])).toBe(false);
  });

  test.each([
    ["vv looks like w", "vvikipedia.org", "wikipedia.org"],
    ["a hyphen is dropped", "ab-c.com", "abc.com"],
    ["i looks like l", "abil.com", "abll.com"],
  ])("a skeleton match: %s", (_name, sender, known) => {
    expect(isLookalike(sender, [known])).toBe(true);
  });
});

describe("registrableDomain: punycode labels", () => {
  test.each([
    ["xn--bcher-kva.example", "bücher.example"],
    ["xn--mnchen-3ya.de", "münchen.de"],
    ["xn--fiqs8s.example", "中国.example"],
    ["xn--80ak6aa92e.com", "аррӏе.com"],
    ["XN--BCHER-KVA.example", "bücher.example"],
    ["xn--wgv71a119e.example", "日本語.example"],
    ["xn--18j882kc2f.example", "げ射故.example"],
    ["xn--p2a0dt811f.example", "쀞ѣѿ.example"],
    ["xn--38jz46v.example", "膺ご.example"],
    ["xn--aaaaa-rh7tj3a.example", "aaaaa늄댎.example"],
    ["xn--dn32g.example", "\u{10ffff}.example"],
  ])("%s decodes to %s", (host, expected) => {
    expect(registrableDomain(host)).toBe(expected);
  });

  test.each([
    ["a character outside the base-36 digits", "xn--bcher-kv!.example"],
    ["a character after z in the digit table", "xn--bcher-{a.example"],
    ["an overflow", "xn--99999999999999.example"],
    ["a non-ASCII character before the last hyphen", "xn--é-a.example"],
    ["the first non-ASCII code point before the last hyphen", "xn--\u0080-a.example"],
    ["a hyphen at the start of the encoded part", "xn---kva.example"],
  ])("invalid input keeps the label: %s", (_name, host) => {
    expect(registrableDomain(host)).toBe(host);
  });
});
