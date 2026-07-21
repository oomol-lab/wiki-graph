import type { Document } from "../../document/index.js";
import {
  parseMentionLinkRecord,
  parseMentionRecord,
  readJsonl,
  validateChapterKnowledgeGraphArtifact,
} from "./artifact-io.js";
import type { ChapterKnowledgeGraphBuildArtifact } from "./types.js";

export async function commitChapterKnowledgeGraphArtifact(
  document: Document,
  artifact: ChapterKnowledgeGraphBuildArtifact,
): Promise<void> {
  const mentions = await readJsonl(artifact.mentionsPath, parseMentionRecord);
  const mentionLinks = await readJsonl(
    artifact.mentionLinksPath,
    parseMentionLinkRecord,
  );

  validateChapterKnowledgeGraphArtifact(artifact.chapterId, {
    mentionLinks,
    mentions,
  });

  await document.openSession(async (openedDocument) => {
    await openedDocument.serials.ensure(artifact.chapterId);
    const existingLinks = await openedDocument.mentionLinks.listByChapter(
      artifact.chapterId,
    );

    if (existingLinks.length > 0 && mentionLinks.length === 0) {
      throw new Error(
        `Refusing to replace chapter ${artifact.chapterId} knowledge graph with an artifact that contains no mention links.`,
      );
    }

    await openedDocument.mentionLinks.deleteByChapter(artifact.chapterId);
    await openedDocument.mentions.deleteByChapter(artifact.chapterId);
    await openedDocument.mentions.saveMany(mentions);
    await openedDocument.mentionLinks.saveMany(mentionLinks);
    const parameter = await openedDocument.graphBuildParameters.save(
      artifact.parameter,
    );
    await openedDocument.serials.setKnowledgeGraphReady(
      artifact.chapterId,
      true,
      parameter.hash,
    );
  });
}

export async function clearChapterKnowledgeGraph(
  document: Document,
  chapterId: number,
): Promise<void> {
  await document.openSession(async (openedDocument) => {
    await openedDocument.mentionLinks.deleteByChapter(chapterId);
    await openedDocument.mentions.deleteByChapter(chapterId);
    await openedDocument.serials.setKnowledgeGraphReady(chapterId, false);
    await openedDocument.graphBuildParameters.deleteUnreferenced();
  });
}
