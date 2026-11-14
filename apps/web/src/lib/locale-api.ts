import type { UserLocale } from "@ea/core/web";
import { z } from "zod";

import { api } from "./api";

// Stores the language of the signed-in user (`users.locale`); the answer has no body.
export function saveLocale(locale: UserLocale): Promise<undefined> {
  return api("/api/me/locale", z.undefined(), { method: "PATCH", body: { locale } });
}
