import { readFile, writeFile } from "fs/promises";

import { describe, expect, it } from "vitest";

import {
  allocateArtifactPath,
  getLogger,
  resolveArtifactPath,
  withLoggingContext,
} from "../../../../packages/core/src/runtime/common/logging.js";
import { withTempDir } from "../../../helpers/temp.js";

describe("common/logging", () => {
  it("preserves flat artifact paths without an active logging context", async () => {
    await withTempDir("wikigraph-logging-", (path) => {
      const artifactPath = resolveArtifactPath({
        category: "llm",
        fileName: "request.log",
        logDirPath: path,
      });

      expect(artifactPath).toBe(`${path}/request.log`);
      return Promise.resolve();
    });
  });

  it("writes contextual artifacts under the run directory", async () => {
    await withTempDir("wikigraph-logging-", async (path) => {
      const { artifactPath, runDirPath } = await withLoggingContext(
        {
          logDirPath: path,
          operation: "digest-test",
          verbose: false,
        },
        async () => {
          getLogger({ component: "test" }).info("hello event log");
          const resolvedPath = resolveArtifactPath({
            category: "llm",
            fileName: "request.log",
            logDirPath: path,
          });

          expect(resolvedPath).toBeDefined();
          await writeFile(resolvedPath!, "request log", "utf8");
          return {
            artifactPath: resolvedPath!,
            runDirPath: resolvedPath!.split("/artifacts/")[0]!,
          };
        },
      );

      expect(artifactPath.startsWith(`${path}/`)).toBe(true);
      expect(artifactPath).toContain("/artifacts/llm/request.log");
      expect(artifactPath).not.toContain("/runs/");
      const content = await readFile(artifactPath, "utf8");
      const eventLog = await readFile(`${runDirPath}/run.log`, "utf8");

      expect(content).toBe("request log");
      expect(eventLog).toContain("INFO");
      expect(eventLog).toContain("hello event log");
      expect(eventLog).not.toContain('{"level":');
      expect(eventLog).not.toContain('{"operation":');
      expect(eventLog).not.toContain("[digest-test");
    });
  });

  it("allocates stable artifact names with numeric suffixes when needed", async () => {
    await withTempDir("wikigraph-logging-", (path) => {
      const firstPath = allocateArtifactPath({
        category: "llm",
        logDirPath: path,
        prefix: "request",
      });
      const secondPath = allocateArtifactPath({
        category: "llm",
        logDirPath: path,
        prefix: "request",
      });

      expect(firstPath).toBe(`${path}/request.log`);
      expect(secondPath).toBe(`${path}/request-2.log`);
      return Promise.resolve();
    });
  });

  it("can allocate numbered artifact names starting at one", async () => {
    await withTempDir("wikigraph-logging-", (path) => {
      const firstPath = allocateArtifactPath({
        alwaysNumbered: true,
        category: "llm",
        logDirPath: path,
        prefix: "request",
      });
      const secondPath = allocateArtifactPath({
        alwaysNumbered: true,
        category: "llm",
        logDirPath: path,
        prefix: "request",
      });

      expect(firstPath).toBe(`${path}/request-1.log`);
      expect(secondPath).toBe(`${path}/request-2.log`);
      return Promise.resolve();
    });
  });
});
