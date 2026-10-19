import { join, toNamespacedPath } from "path";
import { describe, expect, it } from "vitest";
import {
  NodeDirectory,
  NodeFile,
  nodeWikiGraphPlatform,
} from "wiki-graph-sdk/node-platform";
import { withTempDir } from "../helpers/temp.js";
import { startRegressionProcess } from "../helpers/regression-process.js";

describe("Windows WAL transaction and process recovery", () => {
  it.each(["ordinary", "extended", "long"])(
    "recovers committed WAL and discards interrupted writes (%s path)",
    async (kind) => {
      await withTempDir("wg-wal-", async (root) => {
        const directory = join(
          root,
          ...(kind === "long" ? ["a".repeat(120), "b".repeat(120)] : []),
        );
        const folder = new NodeDirectory(directory);
        await folder.createFile("state.sqlite");
        const native = join(directory, "state.sqlite");
        if (kind === "long") expect(native.length).toBeGreaterThan(260);
        const filename =
          kind === "extended" ? toNamespacedPath(native) : native;
        const writer = startRegressionProcess("wal", filename);
        let requestId = 0;
        const query = async (sql: string) => {
          writer.child.send({ id: ++requestId, sql });
          const result = (await writer.message()) as {
            id: number;
            value?: unknown;
            error?: string;
          };
          expect(result.error).toBeUndefined();
          expect(result.id).toBe(requestId);
          return result.value;
        };
        try {
          expect(await writer.message()).toEqual({ ready: true });
          expect(await query("PRAGMA journal_mode=WAL")).toEqual([
            { journal_mode: "wal" },
          ]);
          await query("PRAGMA wal_autocheckpoint=0");
          await query("CREATE TABLE marker(value INTEGER)");
          await query("INSERT INTO marker VALUES(1)");
          const reader = await nodeWikiGraphPlatform.database.open(
            new NodeFile(native),
            { mode: "readonly" },
          );
          try {
            await reader.execute("BEGIN");
            expect(await reader.queryAll("SELECT value FROM marker")).toEqual([
              { value: 1 },
            ]);
            await query("INSERT INTO marker VALUES(2)");
            // The old snapshot remains consistent while another process commits to WAL.
            expect(await reader.queryAll("SELECT value FROM marker")).toEqual([
              { value: 1 },
            ]);
            await reader.execute("COMMIT");
            expect(
              await reader.queryAll("SELECT value FROM marker ORDER BY value"),
            ).toEqual([{ value: 1 }, { value: 2 }]);
            await query("BEGIN IMMEDIATE");
            await query("INSERT INTO marker VALUES(999)");
            expect((await folder.list()).map((entry) => entry.name)).toEqual(
              expect.arrayContaining(["state.sqlite-wal", "state.sqlite-shm"]),
            );
            await writer.stop();
            expect(
              await reader.queryAll("SELECT value FROM marker ORDER BY value"),
            ).toEqual([{ value: 1 }, { value: 2 }]);
          } finally {
            await reader.close();
          }
        } finally {
          await writer.stop();
        }

        const recovery = startRegressionProcess("wal", filename);
        try {
          expect(await recovery.message()).toEqual({ ready: true });
          recovery.child.send({ id: 1, sql: "PRAGMA integrity_check" });
          expect(await recovery.message()).toEqual({
            id: 1,
            value: [{ integrity_check: "ok" }],
          });
          recovery.child.send({
            id: 2,
            sql: "SELECT value FROM marker ORDER BY value",
          });
          expect(await recovery.message()).toEqual({
            id: 2,
            value: [{ value: 1 }, { value: 2 }],
          });
          recovery.child.send({
            id: 3,
            sql: "INSERT INTO marker VALUES(3) RETURNING value",
          });
          expect(await recovery.message()).toEqual({
            id: 3,
            value: [{ value: 3 }],
          });
          recovery.child.send({ id: 4, close: true });
          expect(await recovery.message()).toEqual({ id: 4, value: null });
          expect(await recovery.exit).toBe(0);
        } finally {
          await recovery.stop();
        }
        const reopened = await nodeWikiGraphPlatform.database.open(
          new NodeFile(native),
          { mode: "readwrite", create: false },
        );
        try {
          expect(
            await reopened.queryAll("SELECT value FROM marker ORDER BY value"),
          ).toEqual([{ value: 1 }, { value: 2 }, { value: 3 }]);
          expect(await reopened.queryOne("PRAGMA journal_mode")).toEqual({
            journal_mode: "wal",
          });
        } finally {
          await reopened.close();
        }
        expect((await folder.list()).map((entry) => entry.name)).toEqual([
          "state.sqlite",
        ]);
        await folder.remove("state.sqlite");
        expect(await folder.list()).toEqual([]);
      });
    },
  );
});
