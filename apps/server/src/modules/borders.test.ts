import path from "node:path";

import { describe, expect, test } from "bun:test";
import { ESLint } from "eslint";

const repoRoot = path.resolve(import.meta.dir, "../../../..");
const eslint = new ESLint({ cwd: repoRoot });

async function borderErrors(file: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: path.join(repoRoot, file) });
  expect(result?.messages.filter((message) => message.fatal)).toEqual([]);
  return (result?.messages ?? [])
    .filter((message) => message.ruleId === "import/no-restricted-paths")
    .map((message) => message.message);
}

const fixture = (folder: string) => `apps/server/src/${folder}/__border-fixture.ts`;
const TIMEOUT = 30_000;

describe("module borders: the lint fails", () => {
  test(
    "a deep import into another module",
    async () => {
      const errors = await borderErrors(
        fixture("modules/triage"),
        'import { getMailbox } from "../mail/repo";\nexport const x = getMailbox;\n'
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("Import mail only through its index.ts");
    },
    TIMEOUT
  );

  test(
    "an import from a higher layer",
    async () => {
      const errors = await borderErrors(
        fixture("modules/audit"),
        'import { recordFeedback } from "../triage";\nexport const x = recordFeedback;\n'
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("audit may not import triage");
    },
    TIMEOUT
  );

  test(
    "an import that closes a cycle between two modules (triage imports mail)",
    async () => {
      const errors = await borderErrors(
        fixture("modules/mail"),
        'import { recordFeedback } from "../triage";\nexport const x = recordFeedback;\n'
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("mail may not import triage");
    },
    TIMEOUT
  );

  test(
    "a same-layer reverse edge that closes a cycle (triage imports actions)",
    async () => {
      const errors = await borderErrors(
        fixture("modules/actions"),
        'import { recordFeedback } from "../triage";\nexport const x = recordFeedback;\n'
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("actions may not import triage");
    },
    TIMEOUT
  );

  test(
    "a type-only import from a higher layer",
    async () => {
      const errors = await borderErrors(
        fixture("modules/mail"),
        'import type { ActionsScope } from "../actions";\nexport type X = ActionsScope;\n'
      );
      expect(errors).toHaveLength(1);
    },
    TIMEOUT
  );

  test(
    "a deep import from a subfolder of another module",
    async () => {
      const errors = await borderErrors(
        fixture("modules/channels/telegram"),
        'import { undo } from "../../actions/undo";\nexport const x = undo;\n'
      );
      expect(errors).toHaveLength(1);
    },
    TIMEOUT
  );

  test(
    "a module importing a composition root",
    async () => {
      const errors = await borderErrors(
        fixture("modules/mail"),
        'import { createRetentionJob } from "../../retention";\nexport const x = createRetentionJob;\n'
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("never imports a composition root");
    },
    TIMEOUT
  );

  test(
    "platform importing a module",
    async () => {
      const errors = await borderErrors(
        fixture("platform"),
        'import { getMailbox } from "../modules/mail";\nexport const x = getMailbox;\n'
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("platform imports no module");
    },
    TIMEOUT
  );

  test(
    "a script importing a module file instead of its index",
    async () => {
      const errors = await borderErrors(
        fixture("scripts"),
        'import { insertInboxFolder } from "../modules/mail/repo";\nexport const x = insertInboxFolder;\n'
      );
      expect(errors).toHaveLength(1);
    },
    TIMEOUT
  );

  test(
    "a re-export from another module file",
    async () => {
      const errors = await borderErrors(fixture("modules/triage"), 'export { getMailbox } from "../mail/repo";\n');
      expect(errors).toHaveLength(1);
    },
    TIMEOUT
  );
});

describe("module borders: the lint passes", () => {
  test(
    "a lower layer module through its index",
    async () => {
      expect(
        await borderErrors(
          fixture("modules/triage"),
          'import { getMailbox } from "../mail";\nexport const x = getMailbox;\n'
        )
      ).toEqual([]);
    },
    TIMEOUT
  );

  test(
    "a same-layer module with a permitted pair",
    async () => {
      expect(
        await borderErrors(
          fixture("modules/triage"),
          'import { createPlanned } from "../actions";\nexport const x = createPlanned;\n'
        )
      ).toEqual([]);
    },
    TIMEOUT
  );

  test(
    "a file inside the own module",
    async () => {
      expect(
        await borderErrors(
          fixture("modules/mail"),
          'import { getMailbox } from "./repo";\nexport const x = getMailbox;\n'
        )
      ).toEqual([]);
    },
    TIMEOUT
  );

  test(
    "a script importing a module through its index",
    async () => {
      expect(
        await borderErrors(
          fixture("scripts"),
          'import { getMailbox } from "../modules/mail";\nexport const x = getMailbox;\n'
        )
      ).toEqual([]);
    },
    TIMEOUT
  );
});
