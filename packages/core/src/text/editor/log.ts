import { appendFile, writeFile } from "fs/promises";
import { allocateArtifactPath } from "../../runtime/common/logging.js";

import type { Language } from "../../runtime/common/language.js";
import type { Clue } from "./clue.js";
import { formatIssuesForLog } from "./feedback.js";
import type { CompressionVersion, ReviewResult } from "./types.js";

export class CompressionLog {
  readonly #compressionRatio: number;
  readonly #groupId: number;
  readonly #logDirPath: string | undefined;
  readonly #maxIterations: number;
  readonly #serialId: number;
  #filePath: string | undefined;

  public constructor(
    serialId: number,
    groupId: number,
    options: {
      readonly compressionRatio: number;
      readonly logDirPath?: string;
      readonly maxIterations: number;
    },
  ) {
    this.#compressionRatio = options.compressionRatio;
    this.#groupId = groupId;
    this.#logDirPath = options.logDirPath;
    this.#maxIterations = options.maxIterations;
    this.#serialId = serialId;
  }

  public async appendCompressionResult(input: {
    compressedText: string;
    thinkingText: string;
  }): Promise<void> {
    if (this.#filePath === undefined) {
      return;
    }

    const parts: string[] = [];

    if (input.thinkingText !== "") {
      parts.push(
        "Thinking:",
        "-".repeat(80),
        input.thinkingText,
        "-".repeat(80),
        "",
      );
    }

    parts.push(
      `Compressed Text (${input.compressedText.length} characters):`,
      "-".repeat(80),
      input.compressedText,
      "-".repeat(80),
      "",
      "",
    );

    await appendFile(this.#filePath, `${parts.join("\n")}\n`, "utf8");
  }

  public async appendFinalSelection(
    bestVersion: CompressionVersion,
    originalLength: number,
  ): Promise<void> {
    if (this.#filePath === undefined) {
      return;
    }

    const parts = [
      "",
      "=".repeat(80),
      "FINAL SELECTION",
      "=".repeat(80),
      "",
      `Selected: Iteration ${bestVersion.iteration}/${this.#maxIterations}`,
      `Score: ${bestVersion.score.toFixed(2)}`,
      `Length: ${bestVersion.text.length} characters`,
      `Compression ratio: ${(bestVersion.text.length / originalLength).toFixed(1)}%`,
      "",
      "=".repeat(80),
      "",
    ];

    if (bestVersion.score > 0) {
      parts.push(
        "REMAINING UNRESOLVED ISSUES",
        "=".repeat(80),
        "",
        formatIssuesForLog(bestVersion.reviews),
        "=".repeat(80),
        "",
      );
    }

    await appendFile(this.#filePath, `${parts.join("\n")}\n`, "utf8");
  }

  public async appendIterationHeader(
    iteration: number,
    revisionFeedback: string | undefined,
  ): Promise<void> {
    if (this.#filePath === undefined) {
      return;
    }

    const parts = [
      "",
      "=".repeat(80),
      `ITERATION ${iteration}/${this.#maxIterations}`,
      "=".repeat(80),
      "",
    ];

    if (revisionFeedback !== undefined && revisionFeedback.trim() !== "") {
      parts.push(
        "Revision Feedback:",
        "-".repeat(80),
        revisionFeedback,
        "-".repeat(80),
        "",
      );
    }

    await appendFile(this.#filePath, `${parts.join("\n")}\n`, "utf8");
  }

  public async appendLanguageMismatch(input: {
    detectedLanguageCode: string;
    review: ReviewResult;
    targetLanguageCode: string;
    userLanguage: Language | undefined;
  }): Promise<void> {
    if (this.#filePath === undefined) {
      return;
    }

    const issue = input.review.issues[0];

    if (issue === undefined) {
      return;
    }

    const parts = [
      "",
      "!".repeat(80),
      "LANGUAGE MISMATCH DETECTED",
      "!".repeat(80),
      `Expected: ${input.targetLanguageCode} (${input.userLanguage ?? "unknown"})`,
      `Detected: ${input.detectedLanguageCode}`,
      `Issue: ${issue.problem}`,
      `Suggestion: ${issue.suggestion}`,
      "!".repeat(80),
      "",
    ];

    await appendFile(this.#filePath, `${parts.join("\n")}\n`, "utf8");
  }

  public async initialize(clues: readonly Clue[]): Promise<void> {
    if (this.#logDirPath === undefined) {
      return;
    }

    const timestamp = formatTimestamp(new Date());

    this.#filePath = allocateArtifactPath({
      category: "editor",
      logDirPath: this.#logDirPath,
      prefix: `compression-serial-${this.#serialId}-group-${this.#groupId}`,
    });

    if (this.#filePath === undefined) {
      return;
    }

    await writeFile(
      this.#filePath,
      [
        "=== Text Compression Log ===",
        `Serial: ${this.#serialId}, Group: ${this.#groupId}`,
        `Started at: ${timestamp}`,
        `Compression ratio target: ${Math.round(this.#compressionRatio * 100)}%`,
        `Max iterations: ${this.#maxIterations}`,
        "",
        "",
        formatChunkHierarchy(clues, this.#groupId, this.#serialId),
        "",
      ].join("\n"),
      "utf8",
    );
  }
}

function formatChunkHierarchy(
  clues: readonly Clue[],
  groupId: number,
  serialId: number,
): string {
  const parts = [
    "=".repeat(80),
    `CHUNK HIERARCHY - Serial ${serialId}, Group ${groupId}`,
    "=".repeat(80),
    "",
  ];

  for (let clueIndex = 0; clueIndex < clues.length; clueIndex += 1) {
    const clue = clues[clueIndex];

    if (clue === undefined) {
      continue;
    }

    parts.push(
      `Clue #${clueIndex + 1} (ID: ${clue.clueId})`,
      `|- Weight: ${clue.weight.toFixed(4)}`,
      `|- Label: ${clue.label}`,
      `|- Source snakes: ${clue.sourceSnakeIds.join(", ")}`,
      `|- Merged: ${clue.isMerged ? "yes" : "no"}`,
      `\\- Chunks: ${clue.chunks.length}`,
      "",
    );

    for (let chunkIndex = 0; chunkIndex < clue.chunks.length; chunkIndex += 1) {
      const chunk = clue.chunks[chunkIndex];

      if (chunk === undefined) {
        continue;
      }

      const contentPreview =
        chunk.content.length > 60
          ? `${chunk.content.slice(0, 60)}...`
          : chunk.content;

      parts.push(
        `  - Chunk ${chunkIndex + 1}/${clue.chunks.length} (ID: ${chunk.id})`,
        `    Label: ${chunk.label}`,
        `    Retention: ${chunk.retention ?? "N/A"}`,
        `    Importance: ${chunk.importance ?? "N/A"}`,
        `    Content: ${contentPreview}`,
        "",
      );
    }
  }

  parts.push("=".repeat(80), "");

  return parts.join("\n");
}

function formatTimestamp(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");

  return `${year}-${month}-${day} ${hours}-${minutes}-${seconds}`;
}
