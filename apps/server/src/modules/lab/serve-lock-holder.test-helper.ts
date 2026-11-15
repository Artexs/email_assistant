import { takeServeLock } from "./serve-files";

// A child process of serve-files.test.ts: it takes the serve lock of the directory in argv[2], prints `HELD` (or
// `REFUSED`), and keeps the lock until its stdin closes. It exits without releasing when argv[3] is `crash`.
const dir = process.argv[2] ?? "";
const lock = takeServeLock(dir);
if (lock === undefined) {
  process.stdout.write("REFUSED\n");
  process.exit(1);
}
process.stdout.write("HELD\n");
if (process.argv[3] === "crash") process.exit(0);
process.stdin.resume();
process.stdin.on("end", () => {
  lock.release();
  process.exit(0);
});
