import { z } from "./zod";

export const TERMS_VERSION = "2026-11-12"; // S6e changes it with every change of the legal texts

export const termsAcceptBodySchema = z.object({ version: z.string().min(1).max(40) });
export type TermsAcceptBody = z.infer<typeof termsAcceptBodySchema>;
