import { readFileSync } from "node:fs";
import path from "node:path";

import {
  dataCategories,
  EXTRACT_BODY_MAX,
  EXTRACT_TEXT_MAX,
  extractorInputOf,
  reportMailKinds,
  SENT_MAX_AGE_DAYS,
  SENT_MAX_RECIPIENTS,
  subprocessors,
} from "@ea/core";
import { describe, expect, test } from "bun:test";

import { MAX_ATTEMPTS } from "./modules/loops";
import { prompts } from "./modules/triage";
import { ONE_CLICK_BODY, ONE_CLICK_USER_AGENT } from "./platform/public-http";

// The privacy pages, the claims list and the sub-processor registry name two outside calls that no other test reads: the
// extractor call to the AI provider (open loops) and the one-click unsubscribe request to a newsletter sender. Each limit,
// field and fixed value of these calls is pinned here. A change of the code fails a test until the papers follow; the
// papers then get a new legal version.

const ROOT = path.resolve(import.meta.dir, "../../..");
const read = (file: string): string => readFileSync(path.join(ROOT, file), "utf8");
const privacy = { en: read("apps/web/src/legal/en/privacy.md"), pl: read("apps/web/src/legal/pl/privacy.md") };
const claims = read("docs/legal/claims.md");
const dpia = read("docs/legal/dpia.md");

/** The table line of a claim: the line whose first cell is the id. */
function claimLine(id: string): string {
  const line = claims.split("\n").find((entry) => entry.startsWith(`| ${id} |`));
  if (line === undefined) throw new Error(`no claim row ${id}`);
  return line;
}

// Number strings come from the constants. English groups thousands, Polish writes the plain number. The Polish page writes
// the recipient limit in the instrumental case ("z co najwyżej 10 adresatami").
const bodyCap = {
  en: `${EXTRACT_BODY_MAX.toLocaleString("en-US")} characters`,
  pl: `${EXTRACT_BODY_MAX} znaków`,
};
const ageLimit = { en: `${SENT_MAX_AGE_DAYS} days`, pl: `${SENT_MAX_AGE_DAYS} dni` };
const recipientLimit = { en: `${SENT_MAX_RECIPIENTS} recipients`, pl: `${SENT_MAX_RECIPIENTS} adresatami` };

describe("the outside calls of the privacy papers", () => {
  test.each([
    { name: "body cap of the extractor input", actual: EXTRACT_BODY_MAX, expected: 8000 },
    { name: "age limit of a sent mail in days", actual: SENT_MAX_AGE_DAYS, expected: 14 },
    { name: "recipient limit of a sent mail", actual: SENT_MAX_RECIPIENTS, expected: 10 },
    { name: "length cap of the extracted text", actual: EXTRACT_TEXT_MAX, expected: 80 },
    { name: "attempts of an extractor call", actual: MAX_ATTEMPTS, expected: 3 },
    { name: "extractor prompt version", actual: prompts.extractor.version, expected: "extractor-v1" },
    { name: "body of the one-click request", actual: ONE_CLICK_BODY, expected: "List-Unsubscribe=One-Click" },
    {
      name: "program name of the one-click request",
      actual: ONE_CLICK_USER_AGENT,
      expected: "email-assistant-unsubscribe/1",
    },
    {
      name: "kinds of report mail",
      actual: [...reportMailKinds],
      expected: ["digest", "weekly_report", "trust_report_ready", "autonomy_paused"],
    },
  ])("the $name is pinned: if it changes, re-check the privacy papers", ({ actual, expected }) => {
    expect(actual).toEqual(expected);
  });

  test("the extractor input holds only the subject, the local send time, the recipient count and the body; no address", () => {
    const input = extractorInputOf(
      {
        subject: "Offer",
        bodyText: "Can you send it by Friday?",
        sentAt: new Date("2026-11-20T09:00:00Z"),
        to: ["a@example.com"],
        cc: [],
      },
      "Europe/Warsaw"
    );
    expect(Object.keys(input)).toEqual(["subject", "sentLocal", "recipientCount", "body"]);
    expect(JSON.stringify(input)).not.toContain("a@example.com");
  });

  test.each(["en", "pl"] as const)(
    "the %s privacy page names the body cap, the age limit and the recipient limit",
    (lang) => {
      const page = privacy[lang];
      expect(page).toContain(bodyCap[lang]);
      expect(page).toContain(ageLimit[lang]);
      expect(page).toContain(recipientLimit[lang]);
    }
  );

  test.each(["en", "pl"] as const)("the %s privacy page holds the body of the one-click request", (lang) => {
    expect(privacy[lang]).toContain(ONE_CLICK_BODY);
  });

  test("the claim of the extractor input names the body cap and the prompt version", () => {
    const line = claimLine("C263");
    expect(line).toContain(bodyCap.en);
    expect(line).toContain(prompts.extractor.version);
  });

  test("the claim of the extractor limits names the age limit and the recipient limit", () => {
    const line = claimLine("C264");
    expect(line).toContain(ageLimit.en);
    expect(line).toContain(recipientLimit.en);
  });

  test("the claim of the one-click request names its body and its program name", () => {
    const line = claimLine("C265");
    expect(line).toContain(ONE_CLICK_BODY);
    expect(line).toContain(ONE_CLICK_USER_AGENT);
  });

  test.each(["openai", "gemini"])("the %s sub-processor row names the body cap in both languages", (id) => {
    const service = subprocessors.find((entry) => entry.id === id);
    expect(service?.dataReceived.en).toContain(bodyCap.en);
    expect(service?.dataReceived.pl).toContain(bodyCap.pl);
  });

  test("the unsubscribe requests category covers members and other people", () => {
    const category = dataCategories.find((entry) => entry.id === "unsubscribe-data");
    expect(category?.subjects).toEqual(["users", "others"]);
  });

  test("the deploy guide no longer says that the privacy page lacks the one-click request", () => {
    expect(read("deploy/README.md")).not.toContain("does not yet name the one-click request");
  });
});

describe("dpia", () => {
  test("the DPIA holds the body cap, the age limit and the body of the one-click request", () => {
    expect(dpia).toContain(bodyCap.en);
    expect(dpia).toContain(ageLimit.en);
    expect(dpia).toContain(ONE_CLICK_BODY);
  });

  test("the DPIA has the risk R10 with the levels medium and low, and a row of measures for it", () => {
    const rows = dpia.split("\n").filter((line) => line.split("|")[1]?.trim() === "R10");
    expect(rows.length).toBe(3);
    expect(/\|\s*medium\s*\|\s*low\s*\|$/.test(rows[0] ?? "")).toBe(true);
  });
});
