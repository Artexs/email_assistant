// The input of one drafter call. The mail is untrusted data; the style card, the signature and the instruction come
// from the user. Pure types and the code limits of the prompt.

/** The mail body goes into the prompt up to this many characters. */
export const DRAFTER_MAIL_BODY_MAX = 8000;
export const DRAFTER_SUBJECT_MAX = 300;
export const DRAFTER_NAME_MAX = 200;

export interface DrafterInput {
  mail: {
    subject: string | null;
    fromName: string | null;
    fromAddress: string;
    receivedAt: Date;
    /** The text of the mail with its quoted history. The prompt cuts it. */
    body: string;
  };
  /** The mailbox profile; each field is null when the user set none. */
  style: { displayName: string | null; signature: string | null; writingStyle: string | null };
  /** The user's instruction line for this draft (at most 300 characters), or null. */
  instruction: string | null;
  language: "pl" | "en";
  /** The time of the call; the prompt gives the local date and weekday. */
  today: Date;
  timeZone: string;
}

/** The text the code limit keeps: at most `max` characters, never splitting a surrogate pair. */
export function cutChars(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : chars.slice(0, max).join("");
}
