import { readdir, readFile } from "fs/promises";

import { describe, expect, it } from "vitest";

import { Language } from "../../packages/core/src/runtime/common/language.js";
import {
  ChunkRetention,
  type ChunkRecord,
} from "../../packages/core/src/document/index.js";
import { CompressionLog } from "../../packages/core/src/text/editor/log.js";
import { ReviewSeverity } from "../../packages/core/src/text/editor/types.js";
import { withTempDir } from "../helpers/temp.js";

describe("editor/log", () => {
  it("acts as a no-op when no log directory is configured", async () => {
    const log = new CompressionLog(1, 2, {
      compressionRatio: 0.25,
      maxIterations: 3,
    });

    await log.initialize([]);
    await log.appendIterationHeader(1, "feedback");
    await log.appendCompressionResult({
      compressedText: "summary",
      thinkingText: "reasoning",
    });
    await log.appendLanguageMismatch({
      detectedLanguageCode: "ja",
      review: {
        clueId: -1,
        issues: [],
        weight: 1,
      },
      targetLanguageCode: "en",
      userLanguage: Language.English,
    });
    await log.appendFinalSelection(
      {
        iteration: 1,
        reviews: [],
        score: 0,
        text: "summary",
      },
      100,
    );
  });

  it("writes clue hierarchy, iteration details, language mismatch, and final selection", async () => {
    await withTempDir("wikigraph-editor-log-", async (path) => {
      const log = new CompressionLog(1, 2, {
        compressionRatio: 0.25,
        logDirPath: path,
        maxIterations: 3,
      });

      await log.initialize([
        {
          chunks: [
            createChunkRecord(
              10,
              "A fairly long chunk content that should be truncated after sixty characters in the preview output.",
            ),
          ],
          clueId: 7,
          isMerged: false,
          label: "Lead -> Payoff",
          sourceSnakeIds: [7],
          weight: 0.75,
        },
      ]);
      await log.appendIterationHeader(2, "Address the language mismatch.");
      await log.appendCompressionResult({
        compressedText: "Improved summary",
        thinkingText: "Reasoned through chronology",
      });
      await log.appendLanguageMismatch({
        detectedLanguageCode: "ja",
        review: {
          clueId: -1,
          issues: [
            {
              problem: "Output language error",
              severity: ReviewSeverity.Critical,
              suggestion: "Translate to English",
            },
          ],
          weight: 1,
        },
        targetLanguageCode: "en",
        userLanguage: Language.English,
      });
      await log.appendFinalSelection(
        {
          iteration: 2,
          reviews: [
            {
              clueId: -1,
              issues: [
                {
                  problem: "Residual issue",
                  severity: ReviewSeverity.Minor,
                  suggestion: "Polish wording",
                },
              ],
              weight: 1,
            },
          ],
          score: 1,
          text: "Improved summary",
        },
        80,
      );

      const fileNames = await readdir(path);

      expect(fileNames).toHaveLength(1);
      expect(fileNames[0]).toBe("compression-serial-1-group-2.log");
      const logText = await readFile(`${path}/${fileNames[0]}`, "utf8");

      expect(logText).toContain("CHUNK HIERARCHY - Serial 1, Group 2");
      expect(logText).toContain("Lead -> Payoff");
      expect(logText).toContain(
        "Content: A fairly long chunk content that should be truncated after",
      );
      expect(logText).toContain("ITERATION 2/3");
      expect(logText).toContain("Revision Feedback:");
      expect(logText).toContain("Thinking:");
      expect(logText).toContain("LANGUAGE MISMATCH DETECTED");
      expect(logText).toContain("FINAL SELECTION");
      expect(logText).toContain("REMAINING UNRESOLVED ISSUES");
    });
  });
});

function createChunkRecord(chunkId: number, content: string): ChunkRecord {
  return {
    content,
    generation: 0,
    id: chunkId,
    label: "Chunk label",
    retention: ChunkRetention.Focused,
    sentenceId: [1, 1],
    sentenceIds: [[1, 1]],
    wordsCount: 5,
    weight: 1,
  };
}
