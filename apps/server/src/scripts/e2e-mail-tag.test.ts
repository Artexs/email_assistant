import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, test } from "bun:test";

import {
  assertTaggedMailbox,
  E2E_GREENMAIL_MAILBOXES,
  E2E_PROJECTS,
  e2eApprovalsMailbox,
  e2eDeleteMailbox,
  mailTagFromEnv,
  taggedAddress,
} from "./e2e-seed-args";

// The seed script and its parts: the text that the two source checks below read.
const SEED_DIR = `${import.meta.dir}/e2e-seed`;
const seedSource = (): string =>
  [
    readFileSync(`${import.meta.dir}/e2e-seed.ts`, "utf8"),
    ...readdirSync(SEED_DIR)
      .filter((name) => /^seed-.*\.ts$/.test(name))
      .sort()
      .map((name) => readFileSync(`${SEED_DIR}/${name}`, "utf8")),
  ].join("\n");

async function withTag<T>(tag: string | undefined, run: () => T | Promise<T>): Promise<T> {
  const before = process.env.E2E_MAIL_TAG;
  if (tag === undefined) delete process.env.E2E_MAIL_TAG;
  else process.env.E2E_MAIL_TAG = tag;
  try {
    return await run();
  } finally {
    if (before === undefined) delete process.env.E2E_MAIL_TAG;
    else process.env.E2E_MAIL_TAG = before;
  }
}

describe("taggedAddress", () => {
  test("an empty tag keeps the address", () => {
    expect(taggedAddress("e2e-mobile@e2e.test", "")).toBe("e2e-mobile@e2e.test");
  });

  test("a tag goes before the last @", () => {
    expect(taggedAddress("e2e-mobile@e2e.test", "1ac5ae68")).toBe("e2e-mobile-1ac5ae68@e2e.test");
  });
});

describe("mailTagFromEnv", () => {
  test("unset or empty gives an empty tag", () => {
    expect(mailTagFromEnv({})).toBe("");
    expect(mailTagFromEnv({ E2E_MAIL_TAG: "" })).toBe("");
  });

  test("a valid tag is returned", () => {
    expect(mailTagFromEnv({ E2E_MAIL_TAG: "1ac5ae68" })).toBe("1ac5ae68");
  });

  test.each(["Bad_Tag", "a@b", "a".repeat(17)])("%s throws and names the key", (tag) => {
    expect(() => mailTagFromEnv({ E2E_MAIL_TAG: tag })).toThrow("E2E_MAIL_TAG");
  });
});

describe("GreenMail addresses of the seed", () => {
  test("with a tag, each one ends in the tag and the delete mailbox stays", async () => {
    await withTag("t1", () => {
      for (const make of Object.values(E2E_GREENMAIL_MAILBOXES)) {
        for (const project of E2E_PROJECTS) {
          const addresses = make(project);
          expect(addresses.length).toBeGreaterThan(0);
          for (const address of addresses) expect(address.endsWith("-t1@e2e.test")).toBe(true);
        }
      }
      expect(e2eDeleteMailbox("mobile")).toBe("del-phone@x.test");
    });
  });

  test("without a tag, an address is today's value", async () => {
    await withTag(undefined, () => {
      expect(e2eApprovalsMailbox("mobile")).toBe("e2e-approvals-mobile@e2e.test");
    });
  });

  test("the list holds every address function that the seed gives to seedAssistMailbox", () => {
    const source = seedSource();
    const used = new Set(source.match(/\be2e\w+Mailbox\b/g) ?? []);
    used.delete("e2eDeleteMailbox");
    expect([...used].sort()).toEqual(Object.keys(E2E_GREENMAIL_MAILBOXES).sort());
  });
});

describe("assertTaggedMailbox", () => {
  test("seedAssistMailbox calls the guard before it inserts", () => {
    const source = readFileSync(`${SEED_DIR}/seed-assist-mailbox.ts`, "utf8");
    const body = source.slice(source.indexOf("async function seedAssistMailbox("));
    expect(body.indexOf("assertTaggedMailbox(address, mailTagFromEnv(process.env))")).toBeGreaterThan(0);
    expect(body.indexOf("assertTaggedMailbox(")).toBeLessThan(body.indexOf("insertMailbox("));
  });

  test("with a tag, an address without it is refused", () => {
    expect(() => assertTaggedMailbox("e2e-x-mobile@e2e.test", "t1")).toThrow("E2E_MAIL_TAG");
  });

  test("with a tag, a tagged address passes; without a tag, any address passes", () => {
    expect(() => assertTaggedMailbox("e2e-x-mobile-t1@e2e.test", "t1")).not.toThrow();
    expect(() => assertTaggedMailbox("e2e-x-mobile@e2e.test", "")).not.toThrow();
  });
});
