import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

// F114 stage 04: the server container reads the status file that deploy/backup.sh writes on the host, through a read-only
// bind mount. Only the production file has it; the dev and sim stacks have no backup, so their check is off.

const deployDir = join(import.meta.dir, "..");
const load = (
  name: string
): { services: Record<string, { volumes?: string[]; environment?: Record<string, string> }> } =>
  Bun.YAML.parse(readFileSync(join(deployDir, name), "utf8")) as ReturnType<typeof load>;

describe("compose backup status mount", () => {
  test("the production server mounts ./backup-status read-only and names the file in BACKUP_STATUS_FILE", () => {
    const server = load("compose.yaml").services.server;
    expect(server?.volumes).toEqual(["./backup-status:/run/ea-backup:ro"]);
    expect(server?.environment?.BACKUP_STATUS_FILE).toBe("/run/ea-backup/status.json");
  });

  test("the mounted folder and file name are the ones backup.sh writes", () => {
    const script = readFileSync(join(deployDir, "backup.sh"), "utf8");
    expect(script).toContain("STATUS_DIR=deploy/backup-status");
    expect(script).toContain(`STATUS_FILE="$STATUS_DIR/status.json"`);
  });

  test("the dev file turns the check off with an empty value, and the sim stack has no such key or mount", () => {
    expect(load("compose.dev.yaml").services.server?.environment?.BACKUP_STATUS_FILE).toBe("");
    for (const service of Object.values(load("compose.sim.yaml").services)) {
      expect(service.environment?.BACKUP_STATUS_FILE).toBeUndefined();
      expect((service.volumes ?? []).some((volume) => volume.includes("backup-status"))).toBe(false);
    }
  });
});
