import { describe, expect, test } from "bun:test";

import { type GenerateFn, type GenerateRequest, LlmSoftError } from "../../platform/llm";
import { createFixedLlmClient } from "../../platform/llm/testing";

import { StylistCallError, suggestStyle } from "./stylist";

const input = {
  samples: ["Cześć, termin bez zmian. Daj znać.", "Ok, biorę to na siebie."],
  names: ["marek"],
  language: "pl" as const,
};

function fake(replies: (string | object | Error)[]) {
  const requests: GenerateRequest[] = [];
  const generate: GenerateFn = async (request) => {
    const reply = replies[Math.min(requests.length, replies.length - 1)];
    requests.push(request);
    if (reply instanceof Error) throw reply;
    return {
      text: typeof reply === "string" ? reply : JSON.stringify(reply),
      tokensIn: 100,
      tokensOut: 20,
      blocked: false,
    };
  };
  return { llm: createFixedLlmClient(generate, { model: "fake-stylist" }), requests };
}

describe("suggestStyle", () => {
  test("a clean answer is the suggestion, from one call of the stylist role", async () => {
    const { llm, requests } = fake([{ style: "Pisze krótko i po imieniu." }]);
    const result = await suggestStyle(llm, input);
    expect(result).toMatchObject({ kind: "suggestion", text: "Pisze krótko i po imieniu." });
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]?.usage).toMatchObject({ role: "stylist", promptVersion: "stylist-v1" });
    expect(requests[0]?.prompt).not.toContain("failed the checks");
  });

  test("the suggestion is the cleaned text that the Save of the card takes", async () => {
    const { llm } = fake([{ style: "Pisze krótko.  \r\nPo imieniu." }]);
    const result = await suggestStyle(llm, input);
    expect(result).toMatchObject({ kind: "suggestion", text: "Pisze krótko.\nPo imieniu." });
  });

  test("a failed check gets one retry that names the code and never the failed text", async () => {
    const { llm, requests } = fake([{ style: "Dzwoni na 600 123 456." }, { style: "Pisze krótko." }]);
    const result = await suggestStyle(llm, input);
    expect(result).toMatchObject({ kind: "suggestion", text: "Pisze krótko." });
    expect(requests).toHaveLength(2);
    expect(requests[1]?.prompt).toContain("- phone: the description held a phone number.");
    expect(requests[1]?.prompt).not.toContain("600 123 456");
  });

  test("two answers with a phone fail with the code phone", async () => {
    const { llm, requests } = fake([{ style: "Dzwoni na 600 123 456." }]);
    const result = await suggestStyle(llm, input);
    expect(result).toMatchObject({ kind: "failed", reason: "checks", failures: ["phone"] });
    expect(requests).toHaveLength(2);
  });

  test("a bad schema twice fails with output, and the retry says the answer could not be read", async () => {
    const { llm, requests } = fake([{}]);
    const result = await suggestStyle(llm, input);
    expect(result).toMatchObject({ kind: "failed", reason: "output", failures: [] });
    expect(result.attempts.map((attempt) => attempt.outcome)).toEqual(["bad_output", "bad_output"]);
    expect(requests[1]?.prompt).toContain("could not be read");
  });

  test("maxCalls 1 makes no retry", async () => {
    const { llm, requests } = fake([{ style: "Dzwoni na 600 123 456." }]);
    const result = await suggestStyle(llm, input, { maxCalls: 1 });
    expect(result).toMatchObject({ kind: "failed", reason: "checks" });
    expect(requests).toHaveLength(1);
  });

  test("a provider error ends the call with the attempts so far", async () => {
    const { llm } = fake([new LlmSoftError("http_503", "fake-stylist")]);
    const error = await suggestStyle(llm, input).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(StylistCallError);
    expect((error as StylistCallError).attempts).toHaveLength(1);
  });
});
