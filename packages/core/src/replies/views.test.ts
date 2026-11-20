import { describe, expect, test } from "bun:test";

import { decodedView } from "./views";

describe("the decoded view", () => {
  test.each([
    { name: "spaces inside the brackets", text: "jan ( malpa ) firma", out: "jan@firma" },
    { name: "two spaces before a bare at", text: "jan  at firma dot pl", out: "jan@firma.pl" },
    { name: "two spaces after a bare at", text: "jan at  firma dot pl", out: "jan@firma.pl" },
    { name: "two spaces before a dot word with an at word", text: "jan at firma  dot pl", out: "jan@firma.pl" },
    { name: "two spaces around a dot word after an address", text: "jan@firma  dot  pl", out: "jan@firma.pl" },
    { name: "a dot word after a dotted domain", text: "a@b.co dot pl", out: "a@b.co.pl" },
    { name: "a dot word after a domain part with spaces", text: "a@b . co dot pl", out: "a@b . co.pl" },
    { name: "spaces inside a dot word in brackets", text: "a ( dot ) b", out: "a.b" },
    { name: "spaces inside an at word in brackets", text: "a ( at ) b", out: "a@b" },
    { name: "spaces inside a dot in brackets", text: "a ( . ) b", out: "a.b" },
    { name: "a split scheme", text: "H t t p s://x.pl", out: "Https://x.pl" },
    { name: "a split scheme without s", text: "h t t p ://x.pl", out: "http://x.pl" },
    { name: "a split scheme without a space after the first letter", text: "ht t p://x.pl", out: "http://x.pl" },
    { name: "a split scheme without a space between the t letters", text: "h ttp://x.pl", out: "http://x.pl" },
    { name: "a split scheme without a space before the p", text: "h t tp://x.pl", out: "http://x.pl" },
    { name: "a split scheme without a space before the s", text: "h t t ps://x.pl", out: "https://x.pl" },
    { name: "a split scheme without a space before the colon", text: "h t t p://x.pl", out: "http://x.pl" },
  ])("$name: $text", ({ text, out }) => {
    expect(decodedView(text)).toBe(out);
  });
});
