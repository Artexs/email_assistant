import { readFileSync } from "node:fs";
import path from "node:path";

import {
  buildStyleSamples,
  dataCategories,
  DAY_MS,
  EXTRACT_BODY_MAX,
  EXTRACT_TEXT_MAX,
  extractorInputOf,
  reportMailKinds,
  SENT_MAX_AGE_DAYS,
  SENT_MAX_RECIPIENTS,
  STYLE_MAX_SOURCES,
  STYLE_SAMPLE_MAX_CHARS,
  STYLE_SAMPLES_MAX_CHARS,
  STYLE_SUGGESTION_MAX_CHARS,
  subprocessors,
} from "@ea/core";
import { describe, expect, test } from "bun:test";

import { MAX_ATTEMPTS } from "./modules/loops";
import { STYLE_SUGGEST_DAILY_LIMIT, STYLE_SUGGEST_WINDOW_MS, STYLIST_MAX_CALLS } from "./modules/replies";
import { prompts } from "./modules/triage";
import { ONE_CLICK_BODY, ONE_CLICK_USER_AGENT } from "./platform/public-http";

// The privacy pages, the claims list and the sub-processor registry name three outside calls that no other test reads: the
// extractor call to the AI provider (open loops), the style call to the AI provider (cut sent mail) and the one-click
// unsubscribe request to a newsletter sender. Each limit,
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

// The style call: the cut text of the own sent mail of a mailbox goes to the AI provider after an owner tap.
const styleCaps = {
  sample: {
    en: `${STYLE_SAMPLE_MAX_CHARS.toLocaleString("en-US")} characters`,
    pl: `${STYLE_SAMPLE_MAX_CHARS} znaków`,
  },
  total: {
    en: `${STYLE_SAMPLES_MAX_CHARS.toLocaleString("en-US")} characters`,
    pl: `${STYLE_SAMPLES_MAX_CHARS} znaków`,
  },
  answer: {
    en: `${STYLE_SUGGESTION_MAX_CHARS.toLocaleString("en-US")} characters`,
    pl: `${STYLE_SUGGESTION_MAX_CHARS} znaków`,
  },
};
const styleWindowDays = STYLE_SUGGEST_WINDOW_MS / DAY_MS;
const styleWindow = { en: `${styleWindowDays} days`, pl: `${styleWindowDays} dni` };
const geminiSentence = {
  en: "An install can use Google Gemini instead",
  pl: "Instalacja może zamiast tego używać Google Gemini",
};

/** The text of the style call on a privacy page: from the button label of the page language to the Gemini sentence. */
function styleSlice(lang: "en" | "pl"): string {
  const label = new RegExp(`rs_suggest_button: "([^"]+)"`).exec(read(`apps/web/src/i18n/texts/${lang}-reply.ts`))?.[1];
  if (label === undefined) throw new Error(`no rs_suggest_button text in ${lang}`);
  const page = privacy[lang];
  const from = page.indexOf(label);
  const to = page.indexOf(geminiSentence[lang]);
  if (from === -1 || to <= from) throw new Error(`the style call text is not on the ${lang} privacy page`);
  return page.slice(from, to);
}

describe("style suggestion", () => {
  test.each([
    { name: "per-mail character cap of the style input", actual: STYLE_SAMPLE_MAX_CHARS, expected: 1500 },
    // A string: the number 60000 is a character count here, not a time in milliseconds.
    { name: "total character cap of the style input", actual: `${STYLE_SAMPLES_MAX_CHARS}`, expected: "60000" },
    { name: "mail limit of the style input", actual: STYLE_MAX_SOURCES, expected: 100 },
    { name: "age limit of a sent mail of the style input in days", actual: styleWindowDays, expected: 14 },
    { name: "daily run limit of the style suggestion", actual: STYLE_SUGGEST_DAILY_LIMIT, expected: 3 },
    { name: "call limit of one style suggestion", actual: STYLIST_MAX_CALLS, expected: 2 },
    { name: "character cap of the style answer", actual: STYLE_SUGGESTION_MAX_CHARS, expected: 1000 },
    { name: "style prompt version", actual: prompts.stylist.version, expected: "stylist-v1" },
    { name: "style prompt role", actual: prompts.stylist.role, expected: "stylist" },
  ])("the $name is pinned: if it changes, re-check the privacy papers", ({ actual, expected }) => {
    expect(actual).toEqual(expected);
  });

  test("the style input holds only the cut text, with no subject and no address", () => {
    const input = buildStyleSamples(
      [
        {
          bodyText:
            "Hi team,\nThe offer is attached.\n\nOn Mon, 16 Nov 2026, Anna Nowak wrote:\n> Please send the offer.",
          toAddresses: ["anna.nowak@example.com"],
          ccAddresses: [],
        },
      ],
      { signature: null }
    );
    expect(Object.keys(input)).toEqual(["samples", "names"]);
    expect(input.samples).toEqual(["Hi team,\nThe offer is attached."]);
  });

  test.each(["en", "pl"] as const)(
    "the %s privacy page names the caps, the age limit and the answer cap of the style call",
    (lang) => {
      const slice = styleSlice(lang);
      expect(slice).toContain(styleCaps.sample[lang]);
      expect(slice).toContain(styleCaps.total[lang]);
      expect(slice).toContain(styleWindow[lang]);
      expect(slice).toContain(styleCaps.answer[lang]);
    }
  );

  test("the claims of the style call name the caps, the prompt version and the answer cap", () => {
    const input = claimLine("C271");
    expect(input).toContain(styleCaps.sample.en);
    expect(input).toContain(styleCaps.total.en);
    expect(input).toContain(prompts.stylist.version);
    expect(claimLine("C272")).toContain(styleCaps.answer.en);
  });

  test.each(["openai", "gemini"])("the %s sub-processor row names the style caps in both languages", (id) => {
    const service = subprocessors.find((entry) => entry.id === id);
    for (const lang of ["en", "pl"] as const) {
      expect(service?.dataReceived[lang]).toContain(styleCaps.sample[lang]);
      expect(service?.dataReceived[lang]).toContain(styleCaps.total[lang]);
    }
    if (id === "gemini") expect(service?.dataReceived.en).toContain("writing style");
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
