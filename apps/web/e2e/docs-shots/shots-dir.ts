import { resolve } from "node:path";

import { repoRoot } from "../env";

// Where the docs build reads the screenshots (`apps/docs/public/shots`, ignored by git).
export const SHOTS_DIR = resolve(repoRoot, "apps/docs/public/shots");
