import { mkdir } from "fs/promises";
import { join } from "path";

import type { Document, ReadonlyDocument } from "../../document/index.js";
import { DirectoryDocument } from "../../document/index.js";
import { getChapterDetails, type ChapterDetails } from "../chapter/index.js";
import { createFragmentBackedDocument } from "./document-adapter.js";
import { SummaryInputSnapshotDocument } from "./snapshot/index.js";
import {
  readSummaryInputSnapshot,
  writeSummaryInputSnapshot,
} from "./snapshot-io.js";
import { readSerialFragments } from "./source.js";
import { requireStage } from "./stage.js";
import {
  buildSummaryFromDocument,
  buildSummaryFromReadyDocument,
} from "./summary-build.js";
import type {
  BuildChapterSummaryArtifactOptions,
  ChapterSummaryInputSnapshot,
  SummaryInputSnapshotData,
} from "./types.js";

export async function buildChapterSummaryArtifact(
  document: ReadonlyDocument,
  chapterId: number,
  options: BuildChapterSummaryArtifactOptions,
): Promise<string> {
  const snapshotPath = options.snapshotPath;

  if (snapshotPath !== undefined) {
    return await buildChapterSummaryArtifactFromSnapshot(chapterId, {
      ...options,
      snapshotPath,
    });
  }

  const sourceDocumentPath = options.sourceDocumentPath;

  if (sourceDocumentPath !== undefined) {
    return await buildChapterSummaryArtifactFromDocumentSnapshot(chapterId, {
      ...options,
      sourceDocumentPath,
    });
  }

  return await buildChapterSummaryArtifactFromDocument(
    document,
    chapterId,
    options,
  );
}

export async function buildChapterSummaryArtifactFromSnapshot(
  chapterId: number,
  options: BuildChapterSummaryArtifactOptions & {
    readonly snapshotPath: string;
  },
): Promise<string> {
  const snapshot = await readSummaryInputSnapshot(options.snapshotPath);
  return await buildSummaryFromSnapshot(snapshot, chapterId, options);
}

export async function commitChapterSummaryArtifact(
  document: Document,
  chapterId: number,
  summary: string,
): Promise<ChapterDetails> {
  await document.openSession(async (openedDocument) => {
    await requireStage(openedDocument, chapterId, "graphed");
    await openedDocument.writeSummary(chapterId, summary);
  });

  return await getChapterDetails(document, chapterId);
}

export async function snapshotChapterSummaryInput(
  document: ReadonlyDocument,
  chapterId: number,
  workspacePath: string,
): Promise<ChapterSummaryInputSnapshot> {
  const filePath = join(workspacePath, "summary-input.json");

  await mkdir(workspacePath, { recursive: true });
  await requireStage(document, chapterId, "graphed");

  const fragments = await readSerialFragments(document, chapterId);
  const snakes = await document.snakes.listBySerial(chapterId);
  const snakeChunks = (
    await Promise.all(
      snakes.map(
        async (snake) => await document.snakeChunks.listBySnake(snake.id),
      ),
    )
  ).flat();

  await writeSummaryInputSnapshot(filePath, {
    chunks: await document.chunks.listBySerial(chapterId),
    fragmentGroups: await document.fragmentGroups.listBySerial(chapterId),
    fragments,
    readingEdges: await document.readingEdges.listBySerial(chapterId),
    serial: {
      documentOrder: chapterId,
      id: chapterId,
      knowledgeGraphReady: false,
      revision: 0,
      topologyReady: true,
    },
    snakeChunks,
    snakeEdges: await document.snakeEdges.listBySerial(chapterId),
    snakes,
  });

  return { filePath };
}

async function buildChapterSummaryArtifactFromDocumentSnapshot(
  chapterId: number,
  options: BuildChapterSummaryArtifactOptions & {
    readonly sourceDocumentPath: string;
  },
): Promise<string> {
  const document = await DirectoryDocument.open(options.sourceDocumentPath);

  try {
    return await buildChapterSummaryArtifactFromDocument(
      createFragmentBackedDocument(document, options.sourceDocumentPath),
      chapterId,
      options,
    );
  } finally {
    await document.release();
  }
}

async function buildChapterSummaryArtifactFromDocument(
  document: ReadonlyDocument,
  chapterId: number,
  options: BuildChapterSummaryArtifactOptions,
): Promise<string> {
  const details = await getChapterDetails(document, chapterId);

  if (details.stage !== "graphed") {
    throw new Error(
      `Chapter ${chapterId} is ${details.stage}. Generate a summary only for graphed chapters.`,
    );
  }

  const summary = await document.readSummary(chapterId);

  if (summary !== undefined) {
    return summary;
  }

  return await buildSummaryFromDocument(document, chapterId, options);
}

async function buildSummaryFromSnapshot(
  snapshot: SummaryInputSnapshotData,
  chapterId: number,
  options: BuildChapterSummaryArtifactOptions,
): Promise<string> {
  if (snapshot.serial.id !== chapterId) {
    throw new Error(
      `Summary snapshot belongs to chapter ${snapshot.serial.id}, not chapter ${chapterId}.`,
    );
  }
  if (!snapshot.serial.topologyReady) {
    throw new Error(`Chapter ${chapterId} is not ready for summary.`);
  }

  return await buildSummaryFromReadyDocument(
    new SummaryInputSnapshotDocument(snapshot),
    chapterId,
    options,
  );
}
