import type { UserLocale } from "../tenancy";

// The attachment line of a notice (F109 stage 06). Fixed phrases only: the names come from the mail and are cut in the builder.
export interface AttachmentTexts {
  // The decimal separator of a size in MB.
  decimal: string;
  // The tail of a line that has more attachments than names: `k` is the count that has no name in the line.
  more: (k: number) => string;
}

export const attachmentTexts = {
  en: { decimal: ".", more: (k) => `+${k} more` },
  pl: { decimal: ",", more: (k) => `+${k} więcej` },
} satisfies Record<UserLocale, AttachmentTexts>;
