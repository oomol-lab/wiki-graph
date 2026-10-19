import { describe, expect, it } from "vitest";
import { join } from "path";
import {
  installWikiGraphPlatform,
  withWikiGraphStorage,
} from "../../../../packages/core/src/runtime/platform/index.js";
import {
  createNodeWikiGraphStorage,
  nodeWikiGraphPlatform,
  NodeFile,
} from "../../../../packages/sdk/src/node-platform.js";
import {
  createCoordinatorOwner,
  markArchiveSettlement,
  registerArchiveOwner,
  unregisterArchiveOwner,
} from "../../../../packages/core/src/storage/wikg/wikg-coordinator/owners.js";
import { acquireArchiveCommitLock } from "../../../../packages/core/src/storage/wikg/wikg-coordinator/locks.js";
import {
  listOrphanOverlayPaths,
  listSettleableOverlays,
  publishDeleteOverlay,
} from "../../../../packages/core/src/storage/wikg/wikg-coordinator/overlays.js";
import { withCoordinatorState } from "../../../../packages/core/src/storage/wikg/wikg-coordinator/state.js";
import { withArchiveZipProbe } from "../../../../packages/core/src/storage/wikg/wikg-coordinator/reader-intent.js";
import { createPortableHash } from "../../../../packages/core/src/utils/crypto.js";
import { withTempDir } from "../../../helpers/temp.js";

describe("archive reader admission and settlement phases", () => {
  it("retains a probe owner as reading when native close fails", async () => {
    await withState(async (root) => {
      const file = new NodeFile(join(root, "close-failure.wikg"));
      await nodeWikiGraphPlatform.zip.write(file, [
        { name: "manifest.json", data: new TextEncoder().encode("manifest") },
      ]);
      let closeNative!: () => Promise<void>;
      installWikiGraphPlatform({
        ...nodeWikiGraphPlatform,
        zip: {
          ...nodeWikiGraphPlatform.zip,
          open: async (file, options) => {
            const reader = await nodeWikiGraphPlatform.zip.open(file, options);
            closeNative = reader.close.bind(reader);
            return {
              ...reader,
              close: () => Promise.reject(new Error("native close failed")),
            };
          },
        },
      });
      await expect(
        withArchiveZipProbe(
          file,
          async (reader) => await reader.readEntry("manifest.json"),
        ),
      ).rejects.toThrow("native close failed");
      const key = createPortableHash("sha256")
        .update(file.identity)
        .digest("hex");
      const owners = await withCoordinatorState(async (db) => {
        expect(
          await db.queryAll(
            "SELECT * FROM archive_settlements",
            undefined,
            (row) => row,
          ),
        ).toEqual([]);
        return await db.queryAll(
          "SELECT owner_id FROM archive_owners",
          undefined,
          (row) => String(row.owner_id),
        );
      });
      expect(owners).toHaveLength(1);
      const writer = createCoordinatorOwner();
      await registerArchiveOwner(key, writer);
      expect(await acquireArchiveCommitLock(key, writer)).toBeUndefined();
      // Test teardown explicitly proves native release before removing the
      // retained owner; production recovery instead requires stale host liveness.
      await closeNative();
      await unregisterArchiveOwner(key, owners[0]!);
      await unregisterArchiveOwner(key, writer.ownerId);
    });
  });

  it("fences even schema probe ZIP opens and unregisters after callback failures", async () => {
    await withState(async (root) => {
      const file = new NodeFile(join(root, "probe.wikg"));
      await nodeWikiGraphPlatform.zip.write(file, [
        {
          name: "manifest.json",
          data: new TextEncoder().encode(
            '{"formatVersion":1,"schemaVersion":5}',
          ),
        },
      ]);
      const key = createPortableHash("sha256")
        .update(file.identity)
        .digest("hex");
      const writer = createCoordinatorOwner();
      await registerArchiveOwner(key, writer);
      const release = await acquireArchiveCommitLock(key, writer);
      let attempted!: () => void;
      const attempt = new Promise<void>((resolve) => {
        attempted = resolve;
      });
      let opened = false;
      const platform = nodeWikiGraphPlatform;
      installWikiGraphPlatform({
        ...platform,
        lifecycle: {
          ...platform.lifecycle,
          isInstanceAlive: async (id) => {
            attempted();
            return await platform.lifecycle.isInstanceAlive(id);
          },
        },
        zip: {
          ...platform.zip,
          open: async (file, options) => {
            opened = true;
            return await platform.zip.open(file, options);
          },
        },
      });
      const result = withArchiveZipProbe(file, () =>
        Promise.reject(new Error("probe callback failed")),
      ).catch((error: unknown) => error);
      try {
        await attempt;
        expect(opened).toBe(false);
      } finally {
        await release!();
      }
      expect(await result).toMatchObject({ message: "probe callback failed" });
      expect(opened).toBe(true);
      await withCoordinatorState(async (db) => {
        expect(
          await db.queryAll(
            "SELECT owner_id FROM archive_owners",
            undefined,
            (row) => row,
          ),
        ).toEqual([{ owner_id: writer.ownerId }]);
      });
      await unregisterArchiveOwner(key, writer.ownerId);
    });
  });

  it("defers for a reader intent and blocks new admission during commit", async () => {
    await withState(async () => {
      const writer = createCoordinatorOwner();
      const reader = createCoordinatorOwner();
      const arriving = createCoordinatorOwner();
      await registerArchiveOwner("archive", writer);
      await registerArchiveOwner("archive", reader);
      expect(await acquireArchiveCommitLock("archive", writer)).toBeUndefined();
      await markArchiveSettlement("archive", reader.ownerId);
      const release = await acquireArchiveCommitLock("archive", writer);
      expect(release).toBeTypeOf("function");
      let probed!: () => void;
      const attempted = new Promise<void>((resolve) => {
        probed = resolve;
      });
      const lifecycle = nodeWikiGraphPlatform.lifecycle;
      installWikiGraphPlatform({
        ...nodeWikiGraphPlatform,
        lifecycle: {
          ...lifecycle,
          isInstanceAlive: async (id) => {
            probed();
            return await lifecycle.isInstanceAlive(id);
          },
        },
      });
      let admitted = false;
      const admission = registerArchiveOwner("archive", arriving).then(() => {
        admitted = true;
      });
      try {
        await attempted; // The registration reached its real DB transaction.
        expect(admitted).toBe(false);
        await withCoordinatorState(async (db) => {
          expect(
            await db.queryOne(
              "SELECT owner_id FROM archive_owners WHERE owner_id = ?",
              [arriving.ownerId],
              (row) => row,
            ),
          ).toBeUndefined();
        });
      } finally {
        await release!();
        await admission;
      }
      expect(admitted).toBe(true);
      for (const owner of [writer, reader, arriving]) {
        await unregisterArchiveOwner("archive", owner.ownerId);
      }
      await withCoordinatorState(async (db) => {
        expect(
          await db.queryAll(
            "SELECT * FROM archive_settlements",
            undefined,
            (row) => row,
          ),
        ).toEqual([]);
        expect(
          await db.queryAll(
            "SELECT * FROM archive_commit_locks",
            undefined,
            (row) => row,
          ),
        ).toEqual([]);
      });
    });
  });

  it("only hands rollback obligations to reapers after logical completion", async () => {
    await withState(async () => {
      const publisher = createCoordinatorOwner();
      const observer = createCoordinatorOwner();
      await registerArchiveOwner("archive", publisher);
      await registerArchiveOwner("archive", observer);
      await publishDeleteOverlay({
        archiveIdentity: "opaque-archive",
        archiveKey: "archive",
        entryPath: "texts/summary/1.txt",
        owner: publisher,
      });
      const paths = new Set(["texts/summary/1.txt"]);
      await markArchiveSettlement("archive", publisher.ownerId);
      expect(
        await listSettleableOverlays("archive", paths, observer.ownerId),
      ).toEqual([]);
      expect(await listOrphanOverlayPaths("archive")).toEqual(new Set());
      await markArchiveSettlement("archive", publisher.ownerId, true);
      expect(
        await listSettleableOverlays("archive", paths, observer.ownerId),
      ).toHaveLength(1);
      expect(await listOrphanOverlayPaths("archive")).toEqual(paths);
      for (const owner of [publisher, observer]) {
        await unregisterArchiveOwner("archive", owner.ownerId);
      }
    });
  });

  it("treats existing owners without phase rows conservatively without migrating data", async () => {
    await withState(async () => {
      const writer = createCoordinatorOwner();
      const oldOwner = createCoordinatorOwner();
      await registerArchiveOwner("archive", writer);
      await registerArchiveOwner("archive", oldOwner);
      await withCoordinatorState(async (db) => {
        await db.execute("DROP TABLE archive_settlements");
      });
      // The existing derived-state bootstrap only adds an empty optional table.
      // A missing phase never means that an old owner has released its reader.
      expect(await acquireArchiveCommitLock("archive", writer)).toBeUndefined();
      await withCoordinatorState(async (db) => {
        expect(
          await db.queryAll(
            "SELECT * FROM archive_owners",
            undefined,
            (row) => row,
          ),
        ).toHaveLength(2);
      });
      for (const owner of [writer, oldOwner]) {
        await unregisterArchiveOwner("archive", owner.ownerId);
      }
    });
  });
});

async function withState(operation: (root: string) => Promise<void>) {
  await withTempDir("wg-settlement-", async (root) => {
    try {
      await withWikiGraphStorage(createNodeWikiGraphStorage(root), () =>
        operation(root),
      );
    } finally {
      installWikiGraphPlatform(nodeWikiGraphPlatform);
    }
  });
}
