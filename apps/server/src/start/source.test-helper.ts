import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const startDir = import.meta.dir;
const mainPath = join(startDir, "../main.ts");

// The `start<Runtime>(` calls of main.ts, in the order main.ts makes them.
export function startCalls(): string[] {
  return [...readFileSync(mainPath, "utf8").matchAll(/^(?:const \w+ = )?(?:await )?(start[A-Z]\w*)\(/gm)].map(
    (match) => match[1] ?? ""
  );
}

// The text of main.ts, then of each start file (no test files) in the order main.ts calls its start function.
// A text-reading test reads this instead of main.ts alone.
export function startSource(): string {
  const files = readdirSync(startDir).filter((name) => name.endsWith(".ts") && !/\.test(-helper)?\.ts$/.test(name));
  const parts = [readFileSync(mainPath, "utf8")];
  for (const call of startCalls()) {
    const file = `${call.slice("start".length).toLowerCase()}.ts`;
    if (!files.includes(file)) throw new Error(`main.ts calls ${call}, but start/${file} does not exist`);
    parts.push(readFileSync(join(startDir, file), "utf8"));
  }
  return parts.join("\n");
}
