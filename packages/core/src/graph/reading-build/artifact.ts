import { mkdir, rm } from "fs/promises";
import { join } from "path";

import type { Document } from "../../document/index.js";
import {
  createFragmentBackedDocument,
  DirectoryDocument,
} from "../../document/index.js";
import {
  getChapterDetails,
  requireStage,
  type ChapterDetails,
} from "../../document/chapter/index.js";
import { SerialGeneration } from "../../serial.js";
import { copyChunks, copySnakes } from "./copy.js";
import {
  createGraphBuildParameterInput,
  createTopologyOptions,
} from "./options.js";
import { writeGraphArtifactSourceFragments } from "./source-fragments.js";
import type {
  BuildChapterGraphArtifactOptions,
  ChapterGraphBuildArtifact,
} from "./types.js";

export async function buildChapterGraphArtifact(
  chapterId: number,
  options: BuildChapterGraphArtifactOptions,
): Promise<ChapterGraphBuildArtifact> {
  const documentPath = join(options.workspacePath, "graph-document");

  await rm(documentPath, { force: true, recursive: true });
  await mkdir(options.workspacePath, { recursive: true });

  const document = await DirectoryDocument.open(documentPath);

  try {
    await document.openSession(async (openedDocument) => {
      await openedDocument.serials.createWithId(chapterId);
      await writeGraphArtifactSourceFragments(
        documentPath,
        chapterId,
        options.sourceText,
      );
      const artifactDocument = createFragmentBackedDocument(
        openedDocument,
        documentPath,
      );

      await new SerialGeneration({
        document: artifactDocument,
        llm: options.llm,
        ...(options.logDirPath === undefined
          ? {}
          : { logDirPath: options.logDirPath }),
      }).buildTopologyInto(
        chapterId,
        createTopologyOptions(options),
        options.progressTracker,
      );
    });
  } finally {
    await document.release();
  }

  return {
    chapterId,
    documentPath,
    parameter: createGraphBuildParameterInput(options),
  };
}

export async function commitChapterGraphArtifact(
  document: Document,
  artifact: ChapterGraphBuildArtifact,
): Promise<ChapterDetails> {
  const sourceDocument = await DirectoryDocument.open(artifact.documentPath);

  try {
    await document.openSession(async (openedDocument) => {
      await requireStage(openedDocument, artifact.chapterId, "sourced");
      await openedDocument.clearSerialGraph(artifact.chapterId);
      await openedDocument.serials.ensure(artifact.chapterId);

      const chunkIdMap = await copyChunks(
        sourceDocument,
        openedDocument,
        artifact.chapterId,
      );

      for (const edge of await sourceDocument.readingEdges.listBySerial(
        artifact.chapterId,
      )) {
        const fromId = chunkIdMap.get(edge.fromId);
        const toId = chunkIdMap.get(edge.toId);

        if (fromId === undefined || toId === undefined) {
          continue;
        }

        await openedDocument.readingEdges.save({
          ...edge,
          fromId,
          toId,
        });
      }

      await openedDocument.fragmentGroups.saveMany(
        await sourceDocument.fragmentGroups.listBySerial(artifact.chapterId),
      );
      await copySnakes(
        sourceDocument,
        openedDocument,
        artifact.chapterId,
        chunkIdMap,
      );
      const parameter = await openedDocument.graphBuildParameters.save(
        artifact.parameter,
      );
      await openedDocument.serials.setTopologyReady(
        artifact.chapterId,
        true,
        parameter.hash,
      );
    });

    return await getChapterDetails(document, artifact.chapterId);
  } finally {
    await sourceDocument.release();
  }
}
