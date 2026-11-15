import { errorFields } from "./errors";
import type { Log } from "./log";

/** Server process only: an uncaught exception or an unhandled rejection writes one event with errorFields and exits 1 (Bun's default exit code). */
export function installProcessGuard(log: Log): void {
  process.on("uncaughtException", (error) => {
    log.error("process_uncaught_exception", { ...errorFields(error) });
    process.exit(1);
  });
  process.on("unhandledRejection", (reason) => {
    log.error("process_unhandled_rejection", { ...errorFields(reason) });
    process.exit(1);
  });
}
