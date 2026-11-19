import { classifierV3Parts, type ClassifierV3Part } from "./classifier-v3";

// The parts of every prompt version that has parts. `profile` is the one part of `classifier-v4` that v3 lacks; it comes
// last, so the sections and the rule lines keep the order of v3.
export const classifierParts = [...classifierV3Parts, "profile"] as const;
export type ClassifierPart = (typeof classifierParts)[number];

export const isV3Part = (part: ClassifierPart): part is ClassifierV3Part => part !== "profile";

/**
 * The canonical list of optional parts: sorted by name, once each. It names a run (`classifier-v4[list,profile]`),
 * its state file and its gate file. `attachments` is always on, so it is not listed. The order of the prompt text
 * does not depend on it: that is the type's order.
 */
export function optionalParts(parts: readonly ClassifierPart[]): ClassifierPart[] {
  return classifierParts.filter((part) => part !== "attachments" && parts.includes(part)).sort();
}
