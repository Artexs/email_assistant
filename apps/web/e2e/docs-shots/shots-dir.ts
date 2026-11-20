import { resolve } from "node:path";

import { repoRoot } from "../env";

// Where the docs build reads the screenshots (`apps/docs/public/shots`, ignored by git).
export const SHOTS_DIR = resolve(repoRoot, "apps/docs/public/shots");

// The sign-in of the demo owner that `demo-org-setup.ts` writes when the source is the demo seed (ignored by git).
export const DEMO_OWNER_FILE = resolve(repoRoot, "apps/web/e2e/.demo-owner.json");
