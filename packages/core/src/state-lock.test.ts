import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { describe, expect, it } from "vitest";

import { Database } from "./document/database.js";
import {
  acquireStateLock,
  withStateLock,
  type StateLockMode,
} from "./state-lock.js";

const STATE_LOCK_TEST_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS state_locks (
    scope TEXT NOT NULL,
    resource_key TEXT NOT NULL,
    mode TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    owner_pid INTEGER NOT NULL,
    heartbeat_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (scope, resource_key, owner_id)
  );
`;

describe("state lock coordination", () => {
  it("shares read locks and rejects opportunistic writes while a reader is active", async () => {
    await withStateLockTestDatabase(async (databasePath) => {
      const firstReader = await acquireTestLock(databasePath, "read");

      try {
        const secondReader = await acquireTestLock(databasePath, "read", {
          wait: false,
        });
        const writer = await acquireTestLock(databasePath, "write", {
          wait: false,
        });

        expect(secondReader).toBeDefined();
        expect(writer).toBeUndefined();
        await secondReader?.();
      } finally {
        await firstReader?.();
      }
    });
  });

  it("releases locks when a closure throws", async () => {
    await withStateLockTestDatabase(async (databasePath) => {
      await expect(
        withStateLock(createTestLockOptions(databasePath, "write"), () => {
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");

      const release = await acquireTestLock(databasePath, "write", {
        wait: false,
      });
      expect(release).toBeDefined();
      await release?.();
    });
  });

  it("cleans stale owner rows before acquiring a foreground lock", async () => {
    await withStateLockTestDatabase(async (databasePath) => {
      await insertStateLock(databasePath, {
        heartbeatAt: Date.now(),
        mode: "write",
        ownerId: "dead-owner",
        ownerPid: 999999,
      });

      const release = await acquireTestLock(databasePath, "write", {
        wait: false,
      });

      expect(release).toBeDefined();
      await release?.();
    });
  });
});

async function withStateLockTestDatabase(
  operation: (databasePath: string) => Promise<void>,
): Promise<void> {
  const tempDir = await mkdtemp(join(tmpdir(), "wikigraph-state-lock-test-"));

  try {
    await operation(join(tempDir, "state.sqlite"));
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
}

function createTestLockOptions(databasePath: string, mode: StateLockMode) {
  return {
    databasePath,
    heartbeatMs: 10,
    mode,
    pollMs: 10,
    resourceKey: "resource",
    scope: "test",
    staleMs: 60_000,
  };
}

async function acquireTestLock(
  databasePath: string,
  mode: StateLockMode,
  options: { readonly wait?: boolean } = {},
): Promise<(() => Promise<void>) | undefined> {
  return await acquireStateLock({
    ...createTestLockOptions(databasePath, mode),
    ...options,
  });
}

async function insertStateLock(
  databasePath: string,
  input: {
    readonly heartbeatAt: number;
    readonly mode: StateLockMode;
    readonly ownerId: string;
    readonly ownerPid: number;
  },
): Promise<void> {
  const database = await Database.open(
    databasePath,
    STATE_LOCK_TEST_SCHEMA_SQL,
  );

  try {
    await database.run(
      `
        INSERT INTO state_locks (
          scope, resource_key, mode, owner_id, owner_pid, heartbeat_at, created_at
        ) VALUES ('test', 'resource', ?, ?, ?, ?, ?)
      `,
      [
        input.mode,
        input.ownerId,
        input.ownerPid,
        input.heartbeatAt,
        input.heartbeatAt,
      ],
    );
  } finally {
    await database.close();
  }
}
