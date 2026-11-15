import { resolve } from "node:path";

import { beforeAll, describe, expect, test } from "bun:test";

import { labAddresses, loadLabCorpus, type LabCorpus } from "./corpus";
import { LabMailError } from "./mail-client";
import { LAB_IMAP_PORT, LAB_MAIL_HOST, LAB_MAIL_PASSWORD, LAB_SMTP_PORT } from "./seed";
import { createServeMailClient, labMailOptions } from "./serve-parts";

const ROOT = resolve(import.meta.dir, "../../../../../evals/sim");
let corpus: LabCorpus;
beforeAll(async () => {
  corpus = await loadLabCorpus(ROOT, "lab-01");
});

describe("the mail client of the serve process", () => {
  test("its options are the constants of seed.ts and the scenario addresses", () => {
    const options = labMailOptions(corpus);
    expect(options.host).toBe(LAB_MAIL_HOST);
    expect(options.host).toBe("127.0.0.1");
    expect(options.imapPort).toBe(LAB_IMAP_PORT);
    expect(options.smtpPort).toBe(LAB_SMTP_PORT);
    expect(options.password).toBe(LAB_MAIL_PASSWORD);
    expect([...options.allowedAddresses].sort()).toEqual(labAddresses(corpus));
    // The aliases of the delegates and both run mailboxes are inside the set.
    expect(options.allowedAddresses.has("wiktor.szalewski@kordelan.test")).toBe(true);
    expect(options.allowedAddresses.has("wiktor.szalewski@demo.kordelan.test")).toBe(true);
  });

  test("the client refuses an envelope address outside the scenario before any traffic", async () => {
    const client = createServeMailClient(corpus);
    const inside = "wiktor.szalewski@kordelan.test";
    for (const [from, to] of [
      [inside, "someone@real-company.example"],
      ["someone@real-company.example", inside],
    ] as const) {
      const failure = await client.smtpSend({ envelopeFrom: from, to, raw: "x" }).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(LabMailError);
      expect((failure as LabMailError).code).toBe("address_refused");
    }
  });
});
