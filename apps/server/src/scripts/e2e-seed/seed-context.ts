import type { Config } from "../../platform/config";
import type { createSecretBox } from "../../platform/crypto";
import type { Db } from "../../platform/db";

// What every seed part shares. Each part has two steps: `seed<Area>` writes the rows of the area and returns the ids that
// the second step reads; `finish<Area>` sets the passwords and returns the entry of the area for the seed file.
export interface SeedContext {
  db: Db;
  config: Config;
  secretBox: ReturnType<typeof createSecretBox>;
  // Takes the link of the last reset request for an e-mail address.
  requestLink: (email: string) => Promise<string>;
  // Every password set carries the current terms: the seeded users have accepted them.
  setPassword: (newPassword: string, token: string) => Promise<void>;
}
