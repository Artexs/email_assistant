import type { Category, LlmRole, PromptVersion } from "@ea/core";

import type { ClassifierEmail, ClassifierExtras, SenderContext } from "../classifier";

import * as classifierV2 from "./classifier-v2";
import * as classifierV3 from "./classifier-v3";
import type { ClassifierV3Part } from "./classifier-v3";
import * as classifierV4 from "./classifier-v4";
import * as drafterV1 from "./drafter-v1";
import * as drafterV2 from "./drafter-v2";
import * as drafterV3 from "./drafter-v3";
import * as drafterV4 from "./drafter-v4";
import * as extractorV1 from "./extractor-v1";
import * as judgeV1 from "./judge-v1";
import * as judgeV2 from "./judge-v2";
import * as judgeV3 from "./judge-v3";
import * as judgeV4 from "./judge-v4";
import { type ClassifierPart, isV3Part, optionalParts } from "./parts";
import * as stylistV1 from "./stylist-v1";

/** The prompt of one role in one version; the builders differ per role. */
export interface PromptEntry<R extends LlmRole> {
  role: R;
  /** Equals the file name `<role>-v<n>.ts` and the file's `PROMPT_VERSION`. */
  version: PromptVersion<R>;
  [builder: string]: unknown;
}

export type { ClassifierV3Part } from "./classifier-v3";
export { classifierV3Parts } from "./classifier-v3";
export { type ClassifierPart, classifierParts, optionalParts } from "./parts";

/** One classifier prompt version with the one builder signature of all versions; v2 ignores `extras` and `parts`; v3 ignores `profile`. */
export interface ClassifierPrompt {
  role: "classifier";
  version: PromptVersion<"classifier">;
  /** True when the user prompt reads the extras (attachments, history, urgency, list): the caller then loads them. */
  readsExtras: boolean;
  buildSystem: (allowed: readonly Category[], parts: readonly ClassifierPart[]) => string;
  buildUser: (
    email: ClassifierEmail,
    sender: SenderContext,
    delegates: readonly classifierV2.ClassifierDelegate[],
    nonce: string,
    extras: ClassifierExtras,
    parts: readonly ClassifierPart[]
  ) => string;
}

// Every classifier version that can run: the eval picks one with `--prompt-version`. Production uses the one that
// `prompts.classifier` names.
export const classifierVersions = {
  "classifier-v2": {
    role: "classifier",
    version: classifierV2.PROMPT_VERSION,
    readsExtras: false,
    buildSystem: (allowed) => classifierV2.buildSystemPrompt(allowed),
    buildUser: (email, sender, delegates, nonce) => classifierV2.buildUserPrompt(email, sender, delegates, nonce),
  },
  "classifier-v3": {
    role: "classifier",
    version: classifierV3.PROMPT_VERSION,
    readsExtras: true,
    buildSystem: (allowed, parts) => classifierV3.buildSystemPrompt(allowed, parts.filter(isV3Part)),
    buildUser: (email, sender, delegates, nonce, extras, parts) =>
      classifierV3.buildUserPrompt(email, sender, delegates, nonce, extras, parts.filter(isV3Part)),
  },
  "classifier-v4": {
    role: "classifier",
    version: classifierV4.PROMPT_VERSION,
    readsExtras: true,
    buildSystem: classifierV4.buildSystemPrompt,
    buildUser: classifierV4.buildUserPrompt,
  },
} as const satisfies Record<string, ClassifierPrompt>;
export type ClassifierVersion = keyof typeof classifierVersions;
export const classifierVersionIds = Object.keys(classifierVersions) as ClassifierVersion[];

// The part list of the production prompt when the pointer is `classifier-v3`; `attachments` is always on. A change of
// the list is `classifier-v4` with its own gate.
/** One drafter prompt version: the builders of every version have the signature of `drafter-v1`. */
export interface DrafterPrompt {
  role: "drafter";
  version: PromptVersion<"drafter">;
  buildSystem: () => string;
  buildUser: typeof drafterV1.buildUserPrompt;
}

// Every drafter version that can run: the drafter eval picks one with `--drafter-prompt`. Production uses the one that
// `prompts.drafter` names.
export const drafterVersions = {
  "drafter-v1": {
    role: "drafter",
    version: drafterV1.PROMPT_VERSION,
    buildSystem: drafterV1.buildSystemPrompt,
    buildUser: drafterV1.buildUserPrompt,
  },
  "drafter-v2": {
    role: "drafter",
    version: drafterV2.PROMPT_VERSION,
    buildSystem: drafterV2.buildSystemPrompt,
    buildUser: drafterV2.buildUserPrompt,
  },
  "drafter-v3": {
    role: "drafter",
    version: drafterV3.PROMPT_VERSION,
    buildSystem: drafterV3.buildSystemPrompt,
    buildUser: drafterV3.buildUserPrompt,
  },
  "drafter-v4": {
    role: "drafter",
    version: drafterV4.PROMPT_VERSION,
    buildSystem: drafterV4.buildSystemPrompt,
    buildUser: drafterV4.buildUserPrompt,
  },
} as const satisfies Record<string, DrafterPrompt>;
export type DrafterVersion = keyof typeof drafterVersions;
export const drafterVersionIds = Object.keys(drafterVersions) as DrafterVersion[];

/** One judge prompt version. The rubric items and the answer schema belong to the version: judge-v4 adds a score. */
export interface JudgePrompt {
  role: "judge";
  version: PromptVersion<"judge">;
  buildSystem: typeof judgeV1.buildSystemPrompt;
  buildUser: typeof judgeV1.buildUserPrompt;
  rubricItems: Record<judgeV1.RubricKind, { readonly scores: readonly string[]; readonly checks: readonly string[] }>;
  answerSchema: typeof judgeV1.judgeSchema;
}

// Every judge version that can run: the drafter eval picks one with `--judge-prompt`. The other evals use `prompts.judge`.
export const judgeVersions = {
  "judge-v1": {
    role: "judge",
    version: judgeV1.PROMPT_VERSION,
    buildSystem: judgeV1.buildSystemPrompt,
    buildUser: judgeV1.buildUserPrompt,
    rubricItems: judgeV1.rubricItems,
    answerSchema: judgeV1.judgeSchema,
  },
  "judge-v2": {
    role: "judge",
    version: judgeV2.PROMPT_VERSION,
    buildSystem: judgeV2.buildSystemPrompt,
    buildUser: judgeV2.buildUserPrompt,
    rubricItems: judgeV1.rubricItems,
    answerSchema: judgeV1.judgeSchema,
  },
  "judge-v3": {
    role: "judge",
    version: judgeV3.PROMPT_VERSION,
    buildSystem: judgeV3.buildSystemPrompt,
    buildUser: judgeV3.buildUserPrompt,
    rubricItems: judgeV1.rubricItems,
    answerSchema: judgeV1.judgeSchema,
  },
  "judge-v4": {
    role: "judge",
    version: judgeV4.PROMPT_VERSION,
    buildSystem: judgeV4.buildSystemPrompt,
    buildUser: judgeV4.buildUserPrompt,
    rubricItems: judgeV4.rubricItems,
    answerSchema: judgeV4.judgeSchema,
  },
} as const satisfies Record<string, JudgePrompt>;
export type JudgeVersion = keyof typeof judgeVersions;
export const judgeVersionIds = Object.keys(judgeVersions) as JudgeVersion[];

/** One stylist prompt version: the builders of every version have the signatures of `stylist-v1`. */
export interface StylistPrompt {
  role: "stylist";
  version: PromptVersion<"stylist">;
  buildSystem: () => string;
  buildUser: typeof stylistV1.buildUserPrompt;
}

// Every stylist version that can run: the stylist eval picks one with `--stylist-prompt`. Production uses the one that
// `prompts.stylist` names.
export const stylistVersions = {
  "stylist-v1": {
    role: "stylist",
    version: stylistV1.PROMPT_VERSION,
    buildSystem: stylistV1.buildSystemPrompt,
    buildUser: stylistV1.buildUserPrompt,
  },
} as const satisfies Record<string, StylistPrompt>;
export type StylistVersion = keyof typeof stylistVersions;
export const stylistVersionIds = Object.keys(stylistVersions) as StylistVersion[];

export const CLASSIFIER_V3_PARTS: readonly ClassifierV3Part[] = ["attachments"];

// The prompt each role uses now. A new version is a new file `<role>-v<n>.ts`, a new entry here and a sim gate run with
// its gate file in evals/results/gate/ (docs/code-patterns.md § Side effects; gate-evidence.test.ts checks the file).
export const prompts = {
  classifier: {
    role: "classifier",
    version: classifierV2.PROMPT_VERSION,
    buildSystem: classifierV2.buildSystemPrompt,
    buildUser: classifierV2.buildUserPrompt,
  },
  drafter: drafterVersions["drafter-v4"],
  extractor: {
    role: "extractor",
    version: extractorV1.PROMPT_VERSION,
    buildSystem: extractorV1.buildSystemPrompt,
    buildUser: extractorV1.buildUserPrompt,
  },
  judge: judgeVersions["judge-v3"],
  stylist: stylistVersions["stylist-v1"],
} as const satisfies { [R in LlmRole]?: PromptEntry<R> };

export interface ClassifierPromptChoice {
  version: ClassifierVersion;
  parts: readonly ClassifierPart[];
}

/** The version and part list of the production pointer: the parts count only for v3. The arguments are for tests. */
export function productionClassifierChoice(
  pointer: ClassifierVersion = prompts.classifier.version,
  v3Parts: readonly ClassifierV3Part[] = CLASSIFIER_V3_PARTS
): ClassifierPromptChoice {
  return { version: pointer, parts: pointer === classifierV3.PROMPT_VERSION ? optionalParts(v3Parts) : [] };
}

/** The versions that have a part list: v3 and v4. */
export const versionHasParts = (version: string): boolean =>
  version === classifierV3.PROMPT_VERSION || version === classifierV4.PROMPT_VERSION;

/** `classifier-v4[list,profile]`: the version and the sorted optional parts. Another version has no parts. */
export function promptLabel(choice: { version: string; parts: readonly ClassifierPart[] }): string {
  return versionHasParts(choice.version)
    ? `${choice.version}[${optionalParts(choice.parts).join(",")}]`
    : choice.version;
}

// Roles with no prompt yet, and the epic that writes it.
export const rolesWithoutPrompt = {} as const satisfies Partial<Record<LlmRole, string>>;
