// Test helper for process-guard.test.ts: a process that sets up both guards as main.ts does, then crashes.
import { createLog, installConsoleGuard, setLogFormat } from "../../src/platform/log";
import { installProcessGuard } from "../../src/platform/process-guard";

setLogFormat("json");
installConsoleGuard();
installProcessGuard(createLog("main"));

if (process.argv[2] === "console") {
  // eslint-disable-next-line no-console
  console.error("# SERVER_ERROR: MARKER-CRASH");
} else if (process.argv[2] === "reject") {
  void Promise.reject(new Error("MARKER-CRASH"));
} else if (process.argv[2] === "throw") {
  setTimeout(() => {
    throw new Error("MARKER-CRASH");
  }, 0);
}
