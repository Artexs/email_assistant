// Astro integration: tells `<DemoVideo>` where the demo files are (`<public dir>/demo`) and logs `demo_video: on|off` once.
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AstroIntegration } from "astro";
import { demoFilesExist } from "../src/demo-video";

export default function demoVideo(): AstroIntegration {
  return {
    name: "ea-demo-video",
    hooks: {
      "astro:config:done": ({ config, logger }) => {
        process.env.EA_DOCS_DEMO_DIR ??= join(fileURLToPath(config.publicDir), "demo");
        logger.info(`demo_video: ${demoFilesExist() ? "on" : "off"}`);
      },
    },
  };
}
