import { access, mkdir } from "fs/promises";
import { join } from "path";

import { describe, expect, it } from "vitest";

import { runWikiGraphCLICaptured } from "../../packages/cli/src/index.js";
import { Database } from "../../packages/core/src/document/index.js";
import { NodeFile } from "../../packages/cli/src/runtime/node-platform.js";
import { withTempDir } from "../helpers/temp.js";

describe("cli/maintenance upgrade", () => {
  it("upgrades an old home through its shell-expanded path despite stale jobs", async () => {
    await withTempDir("wikigraph-cli-home-upgrade-", async (stateDir) => {
      await createV3HomeWithStaleJob(stateDir);

      const result = await runWikiGraphCLICaptured({
        argv: ["maintenance", "upgrade", stateDir],
        stateDir,
      });

      expect(result).toStrictEqual({
        exitCode: 0,
        stderr: "",
        stdout: "Home upgraded (schema v3 -> v4)\n",
      });
      await expect(readHomeSchemaVersion(stateDir)).resolves.toBe(4);
      await expect(access(join(stateDir, "jobs/job.sqlite"))).rejects.toThrow();
    });
  });
});

async function createV3HomeWithStaleJob(stateDir: string): Promise<void> {
  await mkdir(join(stateDir, "jobs"), { recursive: true });
  const core = await Database.open(
    new NodeFile(join(stateDir, "core.sqlite")),
    "",
    { create: true, mode: "readwrite" },
  );
  try {
    await core.execute(`
      CREATE TABLE schema_versions (
        scope TEXT PRIMARY KEY,
        version INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    await core.run("INSERT INTO schema_versions VALUES ('home', 3, 'fixture')");
  } finally {
    await core.close();
  }

  const jobs = await Database.open(
    new NodeFile(join(stateDir, "jobs/job.sqlite")),
    "",
    { create: true, mode: "readwrite" },
  );
  try {
    await jobs.execute(`
      CREATE TABLE build_jobs (state TEXT NOT NULL);
      CREATE TABLE build_worker_lease (
        id INTEGER PRIMARY KEY,
        owner_id TEXT,
        owner_pid INTEGER,
        heartbeat_at INTEGER
      );
    `);
    await jobs.run("INSERT INTO build_jobs VALUES ('queued')");
  } finally {
    await jobs.close();
  }
}

async function readHomeSchemaVersion(stateDir: string): Promise<number> {
  const database = await Database.open(
    new NodeFile(join(stateDir, "core.sqlite")),
    "",
    { mode: "readonly" },
  );
  try {
    return await database
      .queryOne(
        "SELECT version FROM schema_versions WHERE scope = 'home'",
        undefined,
        (row) => Number(row.version),
      )
      .then((version) => version ?? 0);
  } finally {
    await database.close();
  }
}
