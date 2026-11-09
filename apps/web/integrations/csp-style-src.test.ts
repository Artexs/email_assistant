import { expect, test } from "bun:test";

import { relaxStyleSrc } from "./csp-style-src";

const RELAXED = "style-src 'self' 'unsafe-inline';";

test("relaxStyleSrc replaces a style-src that ends with a semicolon", () => {
  const html = `<meta http-equiv="content-security-policy" content="script-src 'sha256-a'; style-src 'self' 'sha256-b'; img-src 'self'">`;
  expect(relaxStyleSrc(html)).toBe(
    `<meta http-equiv="content-security-policy" content="script-src 'sha256-a'; ${RELAXED} img-src 'self'">`
  );
});

test("relaxStyleSrc replaces a last style-src without the semicolon and keeps the closing quote", () => {
  const html = `<meta content="script-src 'self'; style-src 'self' 'sha256-b'"><p>x;</p>`;
  expect(relaxStyleSrc(html)).toBe(`<meta content="script-src 'self'; ${RELAXED}"><p>x;</p>`);
});

test("relaxStyleSrc leaves a page without style-src unchanged", () => {
  const html = `<meta content="script-src 'self'">`;
  expect(relaxStyleSrc(html)).toBe(html);
});
