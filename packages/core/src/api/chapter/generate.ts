import { normalizeLanguageCode } from "../../runtime/common/language.js";
import { resolveExtractionPrompt } from "../../runtime/common/prompts.js";
import type { Document } from "../../document/index.js";
import { SerialGeneration } from "../../serial.js";
import { getChapterDetails, requireChapterDetails } from "./details.js";
import { createTopologyOptions } from "./options.js";
import type {
  GenerateChapterGraphOptions,
  GenerateChapterSummaryOptions,
} from "./options.js";
import type { ChapterDetails } from "./types.js";

export async function generateChapterGraph(
  document: Document,
  chapterId: number,
  options: GenerateChapterGraphOptions,
): Promise<ChapterDetails> {
  return await document.openSession(async (openedDocument) => {
    const details = await requireChapterDetails(openedDocument, chapterId);

    if (details.stage !== "sourced") {
      throw new Error(
        `Chapter ${chapterId} is ${details.stage}. Generate a graph only for sourced chapters.`,
      );
    }

    const generation = new SerialGeneration({
      document: openedDocument,
      llm: options.llm,
      ...(options.logDirPath === undefined
        ? {}
        : { logDirPath: options.logDirPath }),
    });
    await openedDocument.clearSerialGraph(chapterId);

    await generation.buildTopologyInto(
      chapterId,
      createTopologyOptions(options),
      options.progressTracker,
    );
    const language = normalizeLanguageCode(options.userLanguage);
    const parameter = await openedDocument.graphBuildParameters.save({
      prompt: resolveExtractionPrompt(options.extractionPrompt),
      ...(language === undefined ? {} : { language }),
    });
    await openedDocument.serials.setTopologyReady(
      chapterId,
      true,
      parameter.hash,
    );
    return await getChapterDetails(openedDocument, chapterId);
  });
}

export async function generateChapterSummary(
  document: Document,
  chapterId: number,
  options: GenerateChapterSummaryOptions,
): Promise<ChapterDetails> {
  return await document.openSession(async (openedDocument) => {
    const details = await requireChapterDetails(openedDocument, chapterId);

    if (details.stage !== "graphed") {
      throw new Error(
        `Chapter ${chapterId} is ${details.stage}. Generate a summary only for graphed chapters.`,
      );
    }

    const generation = new SerialGeneration({
      document: openedDocument,
      llm: options.llm,
      ...(options.logDirPath === undefined
        ? {}
        : { logDirPath: options.logDirPath }),
    });

    await generation.buildSummary(chapterId, {
      ...(options.userLanguage === undefined
        ? {}
        : { userLanguage: options.userLanguage }),
    });
    return await getChapterDetails(openedDocument, chapterId);
  });
}
