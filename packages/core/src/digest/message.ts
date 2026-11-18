import { z } from "zod";

export interface OutButton {
  text: string;
  data: string;
}

// Rows of buttons; `[]` = no keyboard.
export interface OutMessage {
  text: string;
  buttons: OutButton[][];
  // The chat client opens the reply box for this message (Telegram ForceReply): the user's next text is the answer to it.
  forceReply?: true;
}

export const MESSAGE_MAX_CHARS = 4096;
export const CALLBACK_MAX_BYTES = 64;

// Every reader of `outbox.buttons` parses it with this schema.
export const outButtonsSchema = z.array(z.array(z.object({ text: z.string().min(1), data: z.string().min(1) })));
