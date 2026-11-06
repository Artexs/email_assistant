import { z } from "zod";

export interface OutButton {
  text: string;
  data: string;
}

// Rows of buttons; `[]` = no keyboard.
export interface OutMessage {
  text: string;
  buttons: OutButton[][];
}

export const MESSAGE_MAX_CHARS = 4096;
export const CALLBACK_MAX_BYTES = 64;

// Stage 10 parses `outbox.buttons` with this schema.
export const outButtonsSchema = z.array(z.array(z.object({ text: z.string().min(1), data: z.string().min(1) })));
