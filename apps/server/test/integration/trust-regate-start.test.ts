import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, test } from "bun:test";

import { startSource } from "../../src/start/source.test-helper";

describe("the start run", () => {
  const main = readFileSync(path.resolve(import.meta.dir, "../../src/main.ts"), "utf8");
  const triage = readFileSync(path.resolve(import.meta.dir, "../../src/start/triage.ts"), "utf8");
  const all = startSource();
  const call = 'regateAll({ ...regateDeps, run: "start" }';

  test("the start run is awaited before the triage worker and the committer exist", () => {
    // The re-gate is in start/triage.ts, and main.ts awaits that start before the start that builds the committer.
    const start = triage.indexOf(call);
    expect(start).toBeGreaterThan(0);
    // The call is awaited: a start run that is not awaited races the committer.
    expect(triage.slice(start - "await ".length, start)).toBe("await ");
    expect(triage.indexOf("createTriageJob(")).toBeGreaterThan(start);
    expect(triage.indexOf('scheduler.add("triage.worker"')).toBeGreaterThan(start);
    expect(main).toContain("await startTriage(");
    expect(main.indexOf("startTriage(")).toBeLessThan(main.indexOf("startJobs("));
    expect(all.indexOf("createCommitterJob(")).toBeGreaterThan(all.indexOf(call));
    expect(all).toContain('scheduler.add("trust.regate", "20 */5 * * * *"');
    // The tripwire job is registered with the other jobs, and shutdown waits for both trust jobs.
    expect(all).toContain('scheduler.add("trust.tripwire"');
    expect(all).toContain('runs.track("trust.regate"');
    expect(all).toContain('runs.track("trust.tripwire"');
  });

  test("a failure of the whole start run stops the server before the workers start", () => {
    const start = triage.indexOf(call);
    const rest = triage.slice(start);
    const handler = rest.slice(rest.indexOf("} catch (error) {"), rest.indexOf("} catch (error) {") + 220);
    expect(handler).toContain('log.error("trust_regate_failed"');
    expect(handler).toContain("process.exit(1);");
    expect(handler.indexOf("process.exit(1);")).toBeGreaterThan(handler.indexOf("db.destroy()"));
  });
});
