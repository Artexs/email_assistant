import { mkdirSync, readdirSync, rmSync } from "node:fs";

import globalSetup from "../global-setup";
import { SHOTS_DIR } from "./shots-dir";

// Empties the shot folder (a PNG of an older list must not stay), then seeds as the panel run does.
export default function docsShotsSetup(): void {
  mkdirSync(SHOTS_DIR, { recursive: true });
  for (const file of readdirSync(SHOTS_DIR)) {
    if (file.endsWith(".png")) rmSync(`${SHOTS_DIR}/${file}`);
  }
  globalSetup();
}
