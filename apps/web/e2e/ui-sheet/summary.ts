import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { sheetDir } from "./dir";

// The last line of `bun run ui:sheet`: where the index is, and how many pictures and overflow marks the folder holds.
const dir = sheetDir();
const index = join(dir, "index.html");
if (!existsSync(index)) {
  process.stderr.write(`ui_sheet_failed no index in ${dir}\n`);
  process.exit(1);
}
const pictures = readdirSync(dir, { recursive: true, encoding: "utf8" }).filter((file) => file.endsWith(".png")).length;
const marks = (await Bun.file(index).text()).match(/overflow at 320 px/g)?.length ?? 0;
process.stdout.write(`ui_sheet_index ${index}\nui_sheet_pictures ${pictures}\nui_sheet_overflow_marks ${marks}\n`);
