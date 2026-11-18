/// <reference types="bun" />
import { afterEach, describe, expect, test } from "bun:test";

import { ApiError } from "./api";
import {
  changedBody,
  fieldError,
  previewFailureKey,
  previewProfile,
  profilePath,
  replySwitchBlocked,
  serverFieldError,
  valuesOf,
} from "./reply-style";

const ID = "0190f5a0-0000-7000-8000-000000000003";
const view = (over: Partial<Parameters<typeof valuesOf>[0]> = {}) => ({
  displayName: null,
  signature: null,
  writingStyle: null,
  fallbackName: "Owner",
  fallbackSignature: "Owner",
  ...over,
});

describe("the values of the style card (F115 stage 11)", () => {
  test("a stored null is an empty field", () => {
    expect(valuesOf(view())).toEqual({ displayName: "", signature: "", writingStyle: "" });
    expect(valuesOf(view({ displayName: "Anna", writingStyle: "Krótko." }))).toEqual({
      displayName: "Anna",
      signature: "",
      writingStyle: "Krótko.",
    });
  });

  test("a save sends only the fields that changed; an empty text clears a field", () => {
    const saved = { displayName: "Anna", signature: "Hello", writingStyle: "" };
    expect(changedBody(saved, saved)).toEqual({});
    expect(changedBody({ ...saved, signature: "Bye" }, saved)).toEqual({ signature: "Bye" });
    expect(changedBody({ ...saved, displayName: "" }, saved)).toEqual({ displayName: "" });
    expect(changedBody({ displayName: "A", signature: "B", writingStyle: "C" }, saved)).toEqual({
      displayName: "A",
      signature: "B",
      writingStyle: "C",
    });
  });

  test("the path of the profile routes names the mailbox", () => {
    expect(profilePath(ID)).toBe(`/api/mailboxes/${ID}/profile`);
    expect(profilePath(ID, "/preview")).toBe(`/api/mailboxes/${ID}/profile/preview`);
  });
});

describe("the check before a save", () => {
  const ok = { displayName: "Anna", signature: "", writingStyle: "" };

  test("texts that pass give no error", () => {
    expect(fieldError(ok)).toBeNull();
  });

  test("a name with a line break, a header character, or a text that is too long gives the field and its text", () => {
    expect(fieldError({ ...ok, displayName: "A\nB" })).toEqual({ field: "displayName", key: "rs_err_line_break" });
    expect(fieldError({ ...ok, displayName: "A <a@b.c>" })).toEqual({
      field: "displayName",
      key: "rs_err_bad_character",
    });
    expect(fieldError({ ...ok, signature: "x".repeat(1001) })).toEqual({ field: "signature", key: "rs_err_too_long" });
    expect(fieldError({ ...ok, writingStyle: "x".repeat(1001) })).toEqual({
      field: "writingStyle",
      key: "rs_err_too_long",
    });
    expect(fieldError({ ...ok, writingStyle: "x".repeat(1000) })).toBeNull();
  });
});

describe("the answer of the server to a text that fails", () => {
  const rejected = (path: string, message: string, status = 400) =>
    new ApiError(status, "validation", undefined, [{ path, code: "custom", message }]);

  test("a 400 with a profile field gives that field and the text of its code", () => {
    expect(serverFieldError(rejected("displayName", "bad_character"))).toEqual({
      field: "displayName",
      key: "rs_err_bad_character",
    });
    expect(serverFieldError(rejected("writingStyle", "too_long"))).toEqual({
      field: "writingStyle",
      key: "rs_err_too_long",
    });
  });

  test("an unknown code of a profile field gives the generic text; another field or status gives none", () => {
    expect(serverFieldError(rejected("signature", "other"))).toEqual({ field: "signature", key: "error_generic" });
    expect(serverFieldError(rejected("reply_drafts", "oauth_mailbox"))).toBeNull();
    expect(serverFieldError(rejected("signature", "too_long", 500))).toBeNull();
    expect(serverFieldError(new Error("x"))).toBeNull();
    expect(serverFieldError(new ApiError(400, "validation"))).toBeNull();
  });
});

describe("the preview", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });
  const answer = (status: number, body: unknown, seen: { body?: unknown } = {}) => {
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      seen.body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
  };
  const values = { displayName: "Anna", signature: "", writingStyle: "Krótko." };

  test("the failure reasons: two have their text, every other one the generic text", () => {
    expect(previewFailureKey("llm_off")).toBe("rs_preview_llm_off");
    expect(previewFailureKey("llm_cap")).toBe("rs_preview_cap");
    for (const reason of ["checks", "output", "no_draft", "timeout", "toString", ""]) {
      expect(previewFailureKey(reason)).toBe("rs_preview_failed");
    }
  });

  test("a draft gives its body, and the call carries the values of the card as they are", async () => {
    const seen: { body?: unknown } = {};
    answer(200, { body: "Dzień dobry" }, seen);
    expect(await previewProfile(ID, values)).toEqual({ kind: "body", body: "Dzień dobry" });
    expect(seen.body).toEqual(values);
  });

  test("a failed answer gives the text of its reason", async () => {
    answer(200, { kind: "failed", reason: "llm_off" });
    expect(await previewProfile(ID, values)).toEqual({ kind: "failed", key: "rs_preview_llm_off" });
    answer(200, { kind: "failed", reason: "checks" });
    expect(await previewProfile(ID, values)).toEqual({ kind: "failed", key: "rs_preview_failed" });
  });

  test("429 preview_limit and preview_busy are answers with their own text; another error is thrown", async () => {
    answer(429, { error: "preview_limit" });
    expect(await previewProfile(ID, values)).toEqual({ kind: "failed", key: "rs_preview_limit" });
    answer(429, { error: "preview_busy" });
    expect(await previewProfile(ID, values)).toEqual({ kind: "failed", key: "rs_preview_busy" });
    answer(500, { error: "internal" });
    await expect(previewProfile(ID, values)).rejects.toBeInstanceOf(ApiError);
  });
});

describe("the switch of reply drafts", () => {
  test("a mailbox that signs in with a provider cannot turn it on", () => {
    expect(replySwitchBlocked({ oauthProvider: "google" })).toBe(true);
    expect(replySwitchBlocked({ oauthProvider: "microsoft" })).toBe(true);
    expect(replySwitchBlocked({ oauthProvider: null })).toBe(false);
  });
});
