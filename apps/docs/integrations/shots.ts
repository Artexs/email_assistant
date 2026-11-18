// Astro integration: the screenshots of the build (plan P5, stage 11). It tells `<Shot>` where the PNG files are
// (`apps/docs/public/shots`) and logs the mode once: `shots: on` or `shots: off`.
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AstroIntegration } from "astro";
import { shotsOn } from "../src/shots";

export default function shots(): AstroIntegration {
  return {
    name: "ea-shots",
    hooks: {
      "astro:config:done": ({ config, logger }) => {
        process.env.EA_DOCS_SHOTS_DIR ??= join(fileURLToPath(config.root), "public/shots");
        logger.info(`shots: ${shotsOn() ? "on" : "off"}`);
      },
    },
  };
}
