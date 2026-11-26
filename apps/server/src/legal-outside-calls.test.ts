import { readFileSync } from "node:fs";
import path from "node:path";

import {
  buildStyleSamples,
  dataCategories,
  DAY_MS,
  DRAFTER_MAIL_BODY_MAX,
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
import {
  DRAFTER_MAX_CALLS,
  STYLE_SUGGEST_DAILY_LIMIT,
  STYLE_SUGGEST_WINDOW_MS,
  STYLIST_MAX_CALLS,
} from "./modules/replies";
import { prompts } from "./modules/triage";
import { ONE_CLICK_BODY, ONE_CLICK_USER_AGENT } from "./platform/public-http";

// The privacy pages, the claims list, the public security claims and the sub-processor registry name four outside calls
// that no other test reads: the extractor call to the AI provider (open loops), the draft call and the style call to the
// AI provider (reply drafts and cut sent mail) and the one-click unsubscribe request to a newsletter sender. Each limit,
// field and fixed value of these calls is pinned here. A change of the code fails a test until the papers follow; the
// papers then get a new legal version.

const ROOT = path.resolve(import.meta.dir, "../../..");
const read = (file: string): string => readFileSync(path.join(ROOT, file), "utf8");
const privacy = { en: read("apps/web/src/legal/en/privacy.md"), pl: read("apps/web/src/legal/pl/privacy.md") };
const claims = read("docs/legal/claims.md");
const dpia = read("docs/legal/dpia.md");
const securityClaims = read("apps/docs/src/security/claims.ts");

/** The source of one public claim of the security page: from its id line to the id line of the next claim. */
function publicClaimSource(id: string): string {
  const from = securityClaims.indexOf(`id: "${id}"`);
  if (from === -1) throw new Error(`no public claim ${id}`);
  const next = securityClaims.indexOf('\n    id: "', from + 1);
  return securityClaims.slice(from, next === -1 ? undefined : next);
}

/** The text of one language of a public claim: the string after `en: "` or `pl: "` up to the closing quote. */
function publicClaimText(id: string, lang: "en" | "pl"): string {
  const source = publicClaimSource(id);
  const from = source.indexOf(`${lang}: "`);
  const to = from === -1 ? -1 : source.indexOf('",\n', from);
  if (from === -1 || to === -1) throw new Error(`no ${lang} text in public claim ${id}`);
  return source.slice(from, to);
}

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

  test.each(["openai", "deepseek", "gemini"])("the %s sub-processor row names the body cap in both languages", (id) => {
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
const deepseekSentence = {
  en: "When the install uses DeepSeek",
  pl: "Gdy instalacja używa DeepSeek",
};

/** The text of the style call on a privacy page: from the button label of the page language to the DeepSeek sentence. */
function styleSlice(lang: "en" | "pl"): string {
  const label = new RegExp(`rs_suggest_button: "([^"]+)"`).exec(read(`apps/web/src/i18n/texts/${lang}-reply.ts`))?.[1];
  if (label === undefined) throw new Error(`no rs_suggest_button text in ${lang}`);
  const page = privacy[lang];
  const from = page.indexOf(label);
  const to = page.indexOf(deepseekSentence[lang]);
  if (from === -1 || to <= from) throw new Error(`the style call text is not on the ${lang} privacy page`);
  return page.slice(from, to);
}

/** The bullet of the DPIA section "Is the data needed?" that quotes the en button label. */
function dpiaStyleBullet(): string {
  const label = new RegExp(`rs_suggest_button: "([^"]+)"`).exec(read("apps/web/src/i18n/texts/en-reply.ts"))?.[1];
  if (label === undefined) throw new Error("no rs_suggest_button text in en");
  const bullet = dpia.split("\n").find((line) => line.startsWith("  - ") && line.includes(label));
  if (bullet === undefined) throw new Error("the DPIA has no bullet that quotes the style button");
  return bullet;
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

  test("the DPIA bullet of the style call names the per-mail cap, the total cap and the age limit", () => {
    const bullet = dpiaStyleBullet();
    expect(bullet).toContain(styleCaps.sample.en);
    expect(bullet).toContain(styleCaps.total.en);
    expect(bullet).toContain(styleWindow.en);
  });

  test.each(["en", "pl"] as const)(
    "the %s text of the public claim of the style call names the caps, the window and the answer cap",
    (lang) => {
      const text = publicClaimText("ai-provider-style-suggestion", lang);
      expect(text).toContain(styleCaps.sample[lang]);
      expect(text).toContain(styleCaps.total[lang]);
      expect(text).toContain(styleCaps.answer[lang]);
      expect(text).toContain(styleWindow[lang]);
      expect(text).toContain(`${STYLE_MAX_SOURCES}`);
    }
  );

  test("the public claim of the style call names the call limit and cites the style rows of the ledger", () => {
    const claim = publicClaimSource("ai-provider-style-suggestion");
    expect(claim).toContain("at most two calls");
    expect(claim).toContain('ledger: ["C277", "C271", "C272"]');
  });

  test("the claim of the DPIA text of the style call names the total cap", () => {
    expect(claimLine("C273")).toContain(styleCaps.total.en);
  });

  test.each(["openai", "deepseek", "gemini"])(
    "the %s sub-processor row names the style caps in both languages",
    (id) => {
      const service = subprocessors.find((entry) => entry.id === id);
      for (const lang of ["en", "pl"] as const) {
        expect(service?.dataReceived[lang]).toContain(styleCaps.sample[lang]);
        expect(service?.dataReceived[lang]).toContain(styleCaps.total[lang]);
      }
      if (id === "gemini") expect(service?.dataReceived.en).toContain("writing style");
    }
  );
});

// The draft call: the mail that a reply draft answers, with the profile texts of the mailbox, goes to the AI provider.
const draftCap = {
  en: `${DRAFTER_MAIL_BODY_MAX.toLocaleString("en-US")} characters`,
  pl: `${DRAFTER_MAIL_BODY_MAX} znaków`,
};

/** The bullet of the DPIA section "Is the data needed?" for the reply draft. */
function dpiaDraftBullet(): string {
  const bullet = dpia.split("\n").find((line) => line.startsWith("  - Reply draft (flag `reply_drafts`"));
  if (bullet === undefined) throw new Error("the DPIA has no bullet for the reply draft");
  return bullet;
}

describe("reply draft call", () => {
  test.each([
    { name: "body cap of the draft input", actual: DRAFTER_MAIL_BODY_MAX, expected: 8000 },
    { name: "call limit of one draft request", actual: DRAFTER_MAX_CALLS, expected: 2 },
    { name: "draft prompt version", actual: prompts.drafter.version, expected: "drafter-v4" },
    { name: "draft prompt role", actual: prompts.drafter.role, expected: "drafter" },
  ])("the $name is pinned: if it changes, re-check the privacy papers", ({ actual, expected }) => {
    expect(actual).toEqual(expected);
  });

  test.each(["en", "pl"] as const)("the %s text of the public claim of the draft call names the body cap", (lang) => {
    expect(publicClaimText("ai-provider-reply-drafts", lang)).toContain(draftCap[lang]);
  });

  test("the public claim of the draft call names the call limit, the profile texts, the instruction and the ledger rows", () => {
    const claim = publicClaimSource("ai-provider-reply-drafts");
    const text = publicClaimText("ai-provider-reply-drafts", "en");
    expect(text).toContain("at most two calls");
    for (const part of ["display name", "signature", "writing style", "one line of instruction", "time zone"]) {
      expect(text).toContain(part);
    }
    expect(claim).toContain('ledger: ["C277", "C274", "C275"]');
  });

  test("the claims of the draft call name the body cap, the prompt version and the call limit", () => {
    const input = claimLine("C274");
    expect(input).toContain(draftCap.en);
    expect(input).toContain(prompts.drafter.version);
    expect(claimLine("C275")).toContain("at most two calls");
  });

  test("the DPIA names the body cap and the call limit of the draft call in the flow, the bullet and the risk measures", () => {
    const flow = dpia.split("\n").find((line) => line.startsWith("- **Flow.**")) ?? "";
    const measures = dpia.split("\n").find((line) => line.startsWith("| R1   |")) ?? "";
    for (const text of [flow, dpiaDraftBullet(), measures]) {
      expect(text).toContain(draftCap.en);
    }
    expect(flow).toContain("at most two calls");
    expect(dpiaDraftBullet()).toContain("at most two calls");
    expect(measures).toContain("at most two calls");
    expect(claimLine("C276")).toContain(draftCap.en);
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

describe("deepseek", () => {
  const unconfirmed = "to confirm: DeepSeek API data use and retention";

  test.each([
    { lang: "en" as const, country: "People's Republic of China" },
    { lang: "pl" as const, country: "Chińskiej Republice Ludowej" },
  ])(
    "the $lang privacy page names DeepSeek, its country and the open question of API data use",
    ({ lang, country }) => {
      expect(privacy[lang]).toContain("DeepSeek");
      expect(privacy[lang]).toContain(country);
      expect(privacy[lang]).toContain(unconfirmed);
    }
  );

  test("the DPIA names DeepSeek as a provider and holds risk R11 for the transfer to China, with measures and residual level", () => {
    expect(dpia).toContain("`openai`, `deepseek` or `gemini`");
    const rows = dpia.split("\n").filter((line) => line.startsWith("| R11 "));
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatch(/China.*\|\s*medium\s*\|\s*high\s*\|$/);
    expect(rows[1]).toContain("`LLM_PROVIDER`");
    expect(rows[2]).toContain("no adequacy decision for China");
  });

  test.each([
    ["apps/docs/src/content/docs/security.mdx", "People's Republic of China", "has not checked whether DeepSeek"],
    ["apps/docs/src/content/docs/pl/security.mdx", "Chińskiej Republice Ludowej", "nie sprawdził, czy DeepSeek"],
  ])(
    "the public security page %s says where DeepSeek processes data and that its API data use is unchecked",
    (file, country, unchecked) => {
      expect(read(file)).toContain(country);
      expect(read(file)).toContain(unchecked);
    }
  );
});
