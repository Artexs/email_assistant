import { describe, expect, test } from "bun:test";

import { assessSuspicious, trustedAuthResults, type SuspiciousInput, type SuspiciousReason } from "./suspicious";

const TRUSTED = ["mx.firma.pl"];

// A quiet mail: no rule fires. Each case changes only what it needs.
function input(overrides: Partial<SuspiciousInput> = {}): SuspiciousInput {
  return {
    fromAddress: "billing@shop.test",
    fromName: null,
    replyTo: [],
    authResults: null,
    trustedAuthservIds: TRUSTED,
    links: [],
    attachments: [],
    isList: false,
    senderKnown: false,
    knownDomains: [],
    protectedNames: [],
    ...overrides,
  };
}

describe("trustedAuthResults", () => {
  test.each([
    { name: "the results of a trusted id", value: "mx.firma.pl; spf=pass", expected: "; spf=pass" },
    { name: "the value folded to lower case", value: "MX.Firma.PL; SPF=Pass", expected: "; spf=pass" },
    { name: "white space before the id", value: "  mx.firma.pl; spf=pass", expected: "; spf=pass" },
    { name: "a full-width id and semicolon (NFKC)", value: "ｍｘ.firma.pl； spf=pass", expected: "; spf=pass" },
    { name: "a version after the id", value: "mx.firma.pl 1; spf=pass", expected: "; spf=pass" },
    { name: "a tab and a version after the id", value: "mx.firma.pl\t1; spf=pass", expected: "; spf=pass" },
    { name: "a sub-domain of a trusted id", value: "a.mx.firma.pl; dkim=pass", expected: "; dkim=pass" },
    {
      name: "a trusted id with no semicolon: the last character is not dropped",
      value: "mx.firma.plx",
      expected: null,
    },
    {
      name: "the results keep everything after the first semicolon",
      value: "mx.firma.pl; a=1; b=2",
      expected: "; a=1; b=2",
    },
  ])("$name", ({ value, expected }) => {
    expect(trustedAuthResults(value, TRUSTED)).toBe(expected);
  });

  test.each([
    {
      name: "upper case, spaces and a trailing dot",
      trusted: [" MX.firma.pl. "],
      value: "mx.firma.pl; x",
      expected: "; x",
    },
    { name: "several trailing dots", trusted: ["mx.firma.pl.."], value: "mx.firma.pl; x", expected: "; x" },
    { name: "an empty entry does not trust a trailing dot", trusted: [""], value: "mx.; x", expected: null },
    {
      name: "a blank entry next to a real one",
      trusted: [" ", "mx.firma.pl"],
      value: "mx.firma.pl; x",
      expected: "; x",
    },
  ])("a trusted list with $name", ({ trusted, value, expected }) => {
    expect(trustedAuthResults(value, trusted)).toBe(expected);
  });
});

describe("assessSuspicious: auth_fail", () => {
  test.each<{ name: string; authResults: string | null; expected: SuspiciousReason[] }>([
    { name: "dmarc=fail alone", authResults: "mx.firma.pl; dmarc=fail", expected: ["auth_fail"] },
    { name: "dmarc=fail in upper case", authResults: "MX.FIRMA.PL; DMARC=FAIL", expected: ["auth_fail"] },
    { name: "dmarc=fail with spaces around =", authResults: "mx.firma.pl; dmarc = fail", expected: ["auth_fail"] },
    {
      name: "dmarc=fail after other results",
      authResults: "mx.firma.pl; spf=pass; dmarc=fail",
      expected: ["auth_fail"],
    },
    { name: "dmarc=fail in brackets", authResults: "mx.firma.pl; x (dmarc=fail)", expected: ["auth_fail"] },
    { name: "dmarc=fail after a space", authResults: "mx.firma.pl; x dmarc=fail", expected: ["auth_fail"] },
    { name: "dmarc=fail before a comment", authResults: "mx.firma.pl; dmarc=fail (p=none)", expected: ["auth_fail"] },
    { name: "spf=fail and dkim=fail", authResults: "mx.firma.pl; spf=fail; dkim=fail", expected: ["auth_fail"] },
    { name: "dkim=fail and spf=fail", authResults: "mx.firma.pl; dkim=fail; spf=fail", expected: ["auth_fail"] },
    { name: "spf=fail alone", authResults: "mx.firma.pl; spf=fail", expected: [] },
    { name: "dkim=fail alone", authResults: "mx.firma.pl; dkim=fail", expected: [] },
    { name: "spf=fail and dkim=pass", authResults: "mx.firma.pl; spf=fail; dkim=pass", expected: [] },
    { name: "spf=pass and dkim=fail", authResults: "mx.firma.pl; spf=pass; dkim=fail", expected: [] },
    { name: "dmarc=failed", authResults: "mx.firma.pl; dmarc=failed", expected: [] },
    { name: "spf=failed and dkim=fail", authResults: "mx.firma.pl; spf=failed; dkim=fail", expected: [] },
    { name: "spf=fail and dkim=failed", authResults: "mx.firma.pl; spf=fail; dkim=failed", expected: [] },
    { name: "dmarc=fail glued to a word", authResults: "mx.firma.pl; xdmarc=fail", expected: [] },
    { name: "dmarc=pass", authResults: "mx.firma.pl; dmarc=pass", expected: [] },
    { name: "dmarc=fail from an id that is not trusted", authResults: "evil.test; dmarc=fail", expected: [] },
    { name: "no value", authResults: null, expected: [] },
  ])("$name", ({ authResults, expected }) => {
    expect(assessSuspicious(input({ authResults }))).toEqual(expected);
  });
});

describe("assessSuspicious: risky_attachment", () => {
  test.each([
    {
      name: "a risky type with a parameter",
      attachment: { name: "a", type: "application/x-msdownload; name=a" },
      risky: true,
    },
    { name: "a risky type in upper case", attachment: { name: null, type: "APPLICATION/X-MSDOWNLOAD" }, risky: true },
    {
      name: "a risky type with spaces around it",
      attachment: { name: null, type: "  application/x-sh ; x" },
      risky: true,
    },
    { name: "a java archive type", attachment: { name: null, type: "application/java-archive" }, risky: true },
    {
      name: "a double extension in upper case",
      attachment: { name: "faktura.PDF.EXE", type: "application/pdf" },
      risky: true,
    },
    {
      name: "a risky extension with spaces around the name",
      attachment: { name: " faktura.exe ", type: "application/pdf" },
      risky: true,
    },
    {
      name: "a name that is only a risky extension",
      attachment: { name: ".exe", type: "application/pdf" },
      risky: true,
    },
    { name: "a macro document extension", attachment: { name: "plan.docm", type: "application/pdf" }, risky: true },
    { name: "a safe name", attachment: { name: "faktura.pdf", type: "application/pdf" }, risky: false },
    { name: "no name and a safe type", attachment: { name: null, type: "application/pdf" }, risky: false },
    { name: "an empty type and no name", attachment: { name: null, type: "" }, risky: false },
    { name: "a name with no dot", attachment: { name: "exe", type: "application/pdf" }, risky: false },
    {
      name: "a risky extension before the last dot",
      attachment: { name: "a.exe.txt", type: "application/pdf" },
      risky: false,
    },
    { name: "a name that ends in a dot", attachment: { name: "a.", type: "application/pdf" }, risky: false },
    {
      name: "a safe type with a parameter",
      attachment: { name: null, type: "application/pdf; name=a.exe" },
      risky: false,
    },
  ])("$name", ({ attachment, risky }) => {
    expect(assessSuspicious(input({ attachments: [attachment] }))).toEqual(risky ? ["risky_attachment"] : []);
  });

  test("one risky attachment among safe ones gives the reason once", () => {
    const attachments = [
      { name: "a.pdf", type: "application/pdf" },
      { name: "b.exe", type: "application/pdf" },
      { name: "c.scr", type: "application/pdf" },
    ];
    expect(assessSuspicious(input({ attachments }))).toEqual(["risky_attachment"]);
  });
});

describe("assessSuspicious: display_name_spoof", () => {
  const protectedNames = ["Jan Kowalski"];

  test.each<{ name: string; fromAddress: string; fromName: string | null; expected: SuspiciousReason[] }>([
    { name: "the same address in the name", fromAddress: "jan@firma.pl", fromName: "jan@firma.pl", expected: [] },
    {
      name: "the same address with a trailing dot",
      fromAddress: "jan@firma.pl",
      fromName: "jan@firma.pl.",
      expected: [],
    },
    {
      name: "the same address with several trailing dots",
      fromAddress: "jan@firma.pl",
      fromName: "jan@firma.pl..",
      expected: [],
    },
    { name: "the same address in another case", fromAddress: " JAN@Firma.pl ", fromName: "jan@firma.pl", expected: [] },
    {
      name: "the same address in full-width letters",
      fromAddress: "jan@firma.pl",
      fromName: "ｊａｎ@ｆｉｒｍａ.ｐｌ",
      expected: [],
    },
    {
      name: "the same address inside a text",
      fromAddress: "jan@firma.pl",
      fromName: "Kontakt: jan@firma.pl",
      expected: [],
    },
    {
      name: "another address in the name",
      fromAddress: "jan@firma.pl",
      fromName: "jan@bank.pl",
      expected: ["display_name_spoof"],
    },
    {
      name: "another address inside a text",
      fromAddress: "jan@firma.pl",
      fromName: "Jan <jan@bank.pl>",
      expected: ["display_name_spoof"],
    },
    {
      name: "an address with another local part",
      fromAddress: "jan@firma.pl",
      fromName: "ola@firma.pl",
      expected: ["display_name_spoof"],
    },
    {
      name: "a protected name with a double space and capitals",
      fromAddress: "x@firma.pl",
      fromName: "Jan  KOWALSKI",
      expected: ["display_name_spoof"],
    },
    {
      name: "a protected name with a tab and spaces around it",
      fromAddress: "x@firma.pl",
      fromName: "  Jan\tKowalski  ",
      expected: ["display_name_spoof"],
    },
    {
      name: "a protected name with a diacritic",
      fromAddress: "x@firma.pl",
      fromName: "Ján Kowalski",
      expected: ["display_name_spoof"],
    },
    { name: "another name", fromAddress: "x@firma.pl", fromName: "Jan Nowak", expected: [] },
    { name: "only the first name", fromAddress: "x@firma.pl", fromName: "Jan", expected: [] },
    { name: "no name", fromAddress: "x@firma.pl", fromName: null, expected: [] },
    { name: "a name of white space", fromAddress: "x@firma.pl", fromName: "  ", expected: [] },
  ])("with protected Jan Kowalski: $name", ({ fromAddress, fromName, expected }) => {
    expect(assessSuspicious(input({ fromAddress, fromName, protectedNames }))).toEqual(expected);
  });

  test.each<{ name: string; protectedName: string; fromName: string; expected: SuspiciousReason[] }>([
    {
      name: "l with a stroke",
      protectedName: "Paweł Nowak",
      fromName: "Pawel Nowak",
      expected: ["display_name_spoof"],
    },
    {
      name: "an upper case l with a stroke",
      protectedName: "Lukasz Nowak",
      fromName: "ŁUKASZ NOWAK",
      expected: ["display_name_spoof"],
    },
    {
      name: "d with a stroke",
      protectedName: "Đorđe Kovač",
      fromName: "Dorde Kovac",
      expected: ["display_name_spoof"],
    },
    { name: "o with a stroke", protectedName: "Søren Berg", fromName: "Soren Berg", expected: ["display_name_spoof"] },
    {
      name: "a diacritic in the protected name",
      protectedName: "Ján Kowalski",
      fromName: "Jan Kowalski",
      expected: ["display_name_spoof"],
    },
    {
      name: "a ligature (compatibility fold)",
      protectedName: "Fiona Kowal",
      fromName: "ﬁona Kowal",
      expected: ["display_name_spoof"],
    },
    { name: "a protected name of one word", protectedName: "Jan", fromName: "Jan", expected: [] },
    { name: "a protected name of white space", protectedName: "  ", fromName: "  ", expected: [] },
  ])("with protected $protectedName: $name", ({ protectedName, fromName, expected }) => {
    expect(assessSuspicious(input({ fromName, protectedNames: [protectedName] }))).toEqual(expected);
  });

  test("a protected list with no entry gives no spoof", () => {
    expect(assessSuspicious(input({ fromName: "Jan Kowalski", protectedNames: [] }))).toEqual([]);
  });
});

describe("assessSuspicious: reply_to_mismatch", () => {
  test.each<{ name: string; fromAddress: string; replyTo: string[]; expected: SuspiciousReason[] }>([
    { name: "the same address", fromAddress: "jan@firma.pl", replyTo: ["jan@firma.pl"], expected: [] },
    { name: "another domain", fromAddress: "jan@firma.pl", replyTo: ["x@inna.pl"], expected: ["reply_to_mismatch"] },
    {
      name: "a named address of another domain",
      fromAddress: "jan@firma.pl",
      replyTo: ["Jan <x@inna.pl>"],
      expected: ["reply_to_mismatch"],
    },
    {
      name: "a sub-domain of the same registrable domain",
      fromAddress: "jan@firma.pl",
      replyTo: ["x@mail.firma.pl"],
      expected: [],
    },
    {
      name: "the second address is another domain",
      fromAddress: "jan@firma.pl",
      replyTo: ["x@firma.pl", "y@inna.pl"],
      expected: ["reply_to_mismatch"],
    },
    { name: "an address with no @", fromAddress: "jan@firma.pl", replyTo: ["brak"], expected: [] },
    { name: "an address with no domain", fromAddress: "jan@firma.pl", replyTo: ["x@"], expected: [] },
    { name: "an address with a blank domain", fromAddress: "jan@firma.pl", replyTo: ["x@ "], expected: [] },
    {
      name: "a domain with spaces around it",
      fromAddress: "jan@firma.pl",
      replyTo: ["x@ inna.pl "],
      expected: ["reply_to_mismatch"],
    },
    { name: "the last @ gives the domain", fromAddress: "jan@firma.pl", replyTo: ["x@inna.pl@firma.pl"], expected: [] },
    { name: "a From address with no @", fromAddress: "jan", replyTo: ["x@inna.pl"], expected: [] },
    { name: "a From address with no domain", fromAddress: "jan@", replyTo: ["x@inna.pl"], expected: [] },
    {
      name: "a From address with only a domain",
      fromAddress: "@firma.pl",
      replyTo: ["x@inna.pl"],
      expected: ["reply_to_mismatch"],
    },
    {
      name: "a From domain with spaces around it",
      fromAddress: "jan@ firma.pl ",
      replyTo: ["x@firma.pl"],
      expected: [],
    },
    { name: "no Reply-To", fromAddress: "jan@firma.pl", replyTo: [], expected: [] },
  ])("$name", ({ fromAddress, replyTo, expected }) => {
    expect(assessSuspicious(input({ fromAddress, replyTo }))).toEqual(expected);
  });

  test("a mailing list gets no mismatch", () => {
    expect(assessSuspicious(input({ fromAddress: "jan@firma.pl", replyTo: ["x@inna.pl"], isList: true }))).toEqual([]);
  });
});
