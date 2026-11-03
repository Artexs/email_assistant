import { afterEach, describe, expect, test } from "bun:test";

import type { MailProvider, SeedMessage } from "../../src/modules/mail";

export interface ContractEnv {
  provider: MailProvider;
  seed(folder: string, msg: SeedMessage): Promise<void>;
  cleanup(): Promise<void>;
}

const DAY_MS = 86_400_000;

function mail(n: number, extra: Partial<SeedMessage> = {}): SeedMessage {
  return {
    messageId: `<contract-${n}@example.test>`,
    from: "boss@example.test",
    to: ["me@example.test"],
    subject: `Contract ${n}`,
    date: new Date(),
    text: `Body number ${n}`,
    ...extra,
  };
}

/** Runs the same cases on every `MailProvider` (fake and IMAP adapter). */
export function describeMailProviderContract(name: string, makeEnv: () => Promise<ContractEnv>): void {
  describe(`MailProvider contract: ${name}`, () => {
    const envs: ContractEnv[] = [];

    async function freshEnv(): Promise<ContractEnv> {
      const env = await makeEnv();
      envs.push(env);
      return env;
    }

    afterEach(async () => {
      while (envs.length > 0) await envs.pop()?.cleanup();
    });

    test("inboxStatus gives a positive uidValidity and uidNext", async () => {
      const { provider, seed } = await freshEnv();
      await seed("INBOX", mail(1));
      const status = await provider.inboxStatus();
      expect(status.uidValidity).toBeGreaterThan(0);
      expect(status.uidNext).toBeGreaterThan(0);
    });

    test("fetchAbove(0) returns the seeded mails in ascending uid order with their fields", async () => {
      const { provider, seed } = await freshEnv();
      await seed("INBOX", mail(1, { cc: ["cc@example.test"] }));
      await seed(
        "INBOX",
        mail(2, {
          inReplyTo: "<contract-1@example.test>",
          references: ["<root@example.test>", "<contract-1@example.test>"],
        })
      );
      await seed("INBOX", mail(3, { headers: { "X-EA-Action-Id": "act-1" } }));

      const metas = await provider.fetchAbove(0);
      expect(metas).toHaveLength(3);
      const uids = metas.map((m) => m.uid);
      expect(uids).toEqual([...uids].sort((a, b) => a - b));
      expect(metas.map((m) => m.messageId)).toEqual([
        "<contract-1@example.test>",
        "<contract-2@example.test>",
        "<contract-3@example.test>",
      ]);
      expect(metas[0]?.from).toContain("boss@example.test");
      expect(metas[0]?.to.join(",")).toContain("me@example.test");
      expect(metas[0]?.cc.join(",")).toContain("cc@example.test");
      expect(metas[0]?.subject).toBe("Contract 1");
      expect(metas[0]?.actionId).toBeNull();
      expect(metas[1]?.inReplyTo).toBe("<contract-1@example.test>");
      expect(metas[1]?.references).toEqual(["<root@example.test>", "<contract-1@example.test>"]);
      expect(metas[2]?.actionId).toBe("act-1");
    });

    test("fetchAbove(maxUid) returns no uid above maxUid", async () => {
      const { provider, seed } = await freshEnv();
      await seed("INBOX", mail(1));
      await seed("INBOX", mail(2));
      const maxUid = Math.max(...(await provider.fetchAbove(0)).map((m) => m.uid));
      const metas = await provider.fetchAbove(maxUid);
      expect(metas.filter((m) => m.uid > maxUid)).toHaveLength(0);
    });

    test("fetchByUids returns the asked uids", async () => {
      const { provider, seed } = await freshEnv();
      await seed("INBOX", mail(1));
      await seed("INBOX", mail(2));
      await seed("INBOX", mail(3));
      const all = await provider.fetchAbove(0);
      const asked = [all[0]?.uid ?? 0, all[2]?.uid ?? 0];
      const metas = await provider.fetchByUids(asked);
      expect(metas.map((m) => m.uid).sort((a, b) => a - b)).toEqual(asked);
    });

    test("searchInboxSince(yesterday) contains all seeded uids", async () => {
      const { provider, seed } = await freshEnv();
      await seed("INBOX", mail(1));
      await seed("INBOX", mail(2));
      const all = (await provider.fetchAbove(0)).map((m) => m.uid);
      const found = await provider.searchInboxSince(new Date(Date.now() - DAY_MS));
      for (const uid of all) expect(found).toContain(uid);
    });

    test("fetchBodyText returns the text of a text mail", async () => {
      const { provider, seed } = await freshEnv();
      await seed("INBOX", mail(1, { text: "Please approve the budget" }));
      const [meta] = await provider.fetchAbove(0);
      const body = await provider.fetchBodyText(meta?.uid ?? 0);
      expect(body).toContain("Please approve the budget");
    });

    test("fetchBodyText returns the visible text of an html-only mail without tags", async () => {
      const { provider, seed } = await freshEnv();
      await seed("INBOX", mail(1, { text: undefined, html: "<p>Visible words</p>" }));
      const [meta] = await provider.fetchAbove(0);
      const body = await provider.fetchBodyText(meta?.uid ?? 0);
      expect(body).toContain("Visible words");
      expect(body).not.toContain("<p>");
    });

    test("a mail without messageId gives messageId null", async () => {
      const { provider, seed } = await freshEnv();
      await seed("INBOX", mail(1, { messageId: undefined }));
      const [meta] = await provider.fetchAbove(0);
      expect(meta?.messageId).toBeNull();
    });

    test("findByMessageId finds a mail in another folder; null for unknown id or folder", async () => {
      const { provider, seed } = await freshEnv();
      await seed("Archive-test", mail(7));
      const uid = await provider.findByMessageId("Archive-test", "<contract-7@example.test>");
      expect(uid).toBeGreaterThan(0);
      expect(await provider.findByMessageId("Archive-test", "<unknown@example.test>")).toBeNull();
      expect(await provider.findByMessageId("No-such-folder", "<contract-7@example.test>")).toBeNull();
    });

    test("serverInfo lists INBOX", async () => {
      const { provider } = await freshEnv();
      const info = await provider.serverInfo();
      expect(info.folders.map((f) => f.path)).toContain("INBOX");
    });
  });
}
