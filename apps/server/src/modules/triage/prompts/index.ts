import type { LlmRole, PromptVersion } from "@ea/core";

import * as classifierV2 from "./classifier-v2";
import * as judgeV1 from "./judge-v1";

/** The prompt of one role in one version; the builders differ per role. */
export interface PromptEntry<R extends LlmRole> {
  role: R;
  /** Equals the file name `<role>-v<n>.ts` and the file's `PROMPT_VERSION`. */
  version: PromptVersion<R>;
  [builder: string]: unknown;
}

// The prompt each role uses now. A new version is a new file `<role>-v<n>.ts`, a new entry here and a passing eval
// (docs/code-patterns.md § Side effects).
export const prompts = {
  classifier: {
    role: "classifier",
    version: classifierV2.PROMPT_VERSION,
    buildSystem: classifierV2.buildSystemPrompt,
    buildUser: classifierV2.buildUserPrompt,
  },
  judge: {
    role: "judge",
    version: judgeV1.PROMPT_VERSION,
    buildSystem: judgeV1.buildSystemPrompt,
    buildUser: judgeV1.buildUserPrompt,
  },
} as const satisfies { [R in LlmRole]?: PromptEntry<R> };

// Roles with no prompt yet, and the epic that writes it.
export const rolesWithoutPrompt = {
  drafter: "E6a",
  extractor: "E5b",
  escalation: "E3b",
} as const satisfies Partial<Record<LlmRole, string>>;
