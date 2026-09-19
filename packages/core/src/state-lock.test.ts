import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { describe, expect, it } from "vitest";

import { Database } from "./document/database.js";
import { NodeFile } from "../../cli/src/runtime/node-platform.js";
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
  it("allows read/read sharing while making writes wait for existing reads", async () => {
    await withStateLockTestDatabase(async (databasePath) => {
      const order: string[] = [];
      const readerStarted = createBarrier();
      const releaseReaders = createBarrier();
      const writerCompleted = createBarrier();

      const firstReader = withStateLock(
        createTestLockOptions(databasePath, "read"),
        async () => {
          order.push("first-read-enter");
          readerStarted.resolve();
          await releaseReaders.promise;
          order.push("first-read-exit");
        },
      );
      await readerStarted.promise;

      const secondReader = await acquireTestLock(databasePath, "read", {
        wait: false,
      });
      expect(secondReader).toBeDefined();

      const writer = withStateLock(
        createTestLockOptions(databasePath, "write"),
        () => {
          order.push("write-enter");
          writerCompleted.resolve();
        },
      );

      await delay(20);
      expect(order).toStrictEqual(["first-read-enter"]);

      await secondReader?.();
      releaseReaders.resolve();
      await Promise.all([firstReader, writer, writerCompleted.promise]);
      expect(order).toStrictEqual([
        "first-read-enter",
        "first-read-exit",
        "write-enter",
      ]);
    });
  });

  it("makes a second writer wait for the first writer", async () => {
    await withStateLockTestDatabase(async (databasePath) => {
      const order: string[] = [];
      const firstWriterStarted = createBarrier();
      const releaseFirstWriter = createBarrier();

      const firstWriter = withStateLock(
        createTestLockOptions(databasePath, "write"),
        async () => {
          order.push("first-write-enter");
          firstWriterStarted.resolve();
          await releaseFirstWriter.promise;
          order.push("first-write-exit");
        },
      );
      await firstWriterStarted.promise;

      const secondWriter = withStateLock(
        createTestLockOptions(databasePath, "write"),
        () => {
          order.push("second-write-enter");
        },
      );

      await delay(20);
      expect(order).toStrictEqual(["first-write-enter"]);

      releaseFirstWriter.resolve();
      await Promise.all([firstWriter, secondWriter]);
      expect(order).toStrictEqual([
        "first-write-enter",
        "first-write-exit",
        "second-write-enter",
      ]);
    });
  });

  it("waits instead of throwing lock conflicts for the closure API", async () => {
    await withStateLockTestDatabase(async (databasePath) => {
      const holderRelease = await acquireTestLock(databasePath, "write");
      const events: string[] = [];

      const waiter = withStateLock(
        createTestLockOptions(databasePath, "read"),
        () => {
          events.push("waiter-entered");
        },
      );

      await delay(20);
      expect(events).toStrictEqual([]);

      await holderRelease?.();
      await expect(waiter).resolves.toBeUndefined();
      expect(events).toStrictEqual(["waiter-entered"]);
    });
  });

  it("returns undefined for opportunistic acquire while locked and releases a free acquire", async () => {
    await withStateLockTestDatabase(async (databasePath) => {
      const holderRelease = await acquireTestLock(databasePath, "read");

      try {
        await expect(
          acquireTestLock(databasePath, "write", { wait: false }),
        ).resolves.toBeUndefined();
      } finally {
        await holderRelease?.();
      }

      const release = await acquireTestLock(databasePath, "write", {
        wait: false,
      });
      expect(release).toBeDefined();
      await release?.();
      await expect(countStateLocks(databasePath)).resolves.toBe(0);
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

  it("cleans locks whose lease heartbeat has expired", async () => {
    await withStateLockTestDatabase(async (databasePath) => {
      const now = Date.now();
      await insertStateLock(databasePath, {
        heartbeatAt: now - 120_000,
        mode: "write",
        ownerId: "expired-dead-owner",
        ownerPid: 999999,
      });

      const release = await acquireTestLock(databasePath, "write", {
        wait: false,
      });
      expect(release).toBeDefined();
      await release?.();
      await expect(listStateLockOwnerIds(databasePath)).resolves.toStrictEqual(
        [],
      );
    });
  });

  it("does not depend on a host process when reclaiming expired locks", async () => {
    await withStateLockTestDatabase(async (databasePath) => {
      await insertStateLock(databasePath, {
        heartbeatAt: Date.now() - 120_000,
        mode: "write",
        ownerId: "expired-live-owner",
        ownerPid: process.pid,
      });

      const release = await acquireTestLock(databasePath, "write", {
        wait: false,
      });
      expect(release).toBeDefined();
      await release?.();
      await expect(listStateLockOwnerIds(databasePath)).resolves.toStrictEqual(
        [],
      );
    });
  });

  it("preserves fresh locks even when the owner process is gone", async () => {
    await withStateLockTestDatabase(async (databasePath) => {
      await insertStateLock(databasePath, {
        heartbeatAt: Date.now(),
        mode: "write",
        ownerId: "fresh-dead-owner",
        ownerPid: 999999,
      });

      await expect(
        acquireTestLock(databasePath, "write", { wait: false }),
      ).resolves.toBeUndefined();
      await expect(listStateLockOwnerIds(databasePath)).resolves.toStrictEqual([
        "fresh-dead-owner",
      ]);
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
    databaseFile: new NodeFile(databasePath),
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
    { create: true, mode: "readwrite" },
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

async function countStateLocks(databasePath: string): Promise<number> {
  const database = await Database.open(
    databasePath,
    STATE_LOCK_TEST_SCHEMA_SQL,
    { create: true, mode: "readwrite" },
  );

  try {
    return (
      (await database.queryOne(
        "SELECT COUNT(*) AS count FROM state_locks",
        undefined,
        (row) => Number(row.count),
      )) ?? 0
    );
  } finally {
    await database.close();
  }
}

async function listStateLockOwnerIds(databasePath: string): Promise<string[]> {
  const database = await Database.open(
    databasePath,
    STATE_LOCK_TEST_SCHEMA_SQL,
    { create: true, mode: "readwrite" },
  );

  try {
    return await database.queryAll(
      "SELECT owner_id FROM state_locks ORDER BY owner_id",
      undefined,
      (row) => String(row.owner_id),
    );
  } finally {
    await database.close();
  }
}

function createBarrier(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} {
  let resolveBarrier: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    resolveBarrier = resolve;
  });

  return { promise, resolve: resolveBarrier };
}

async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
}
