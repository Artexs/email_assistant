import { z } from "zod";

import { draftKinds } from "../triage/payloads";

export const isoDate = z.iso.datetime().transform((value) => new Date(value));
export const id = z.string().min(1);
export const draftKind = z.enum(draftKinds);
export const text = z.string();
export const nullableText = z.string().nullable();
export const timeZone = z.string().min(1);
