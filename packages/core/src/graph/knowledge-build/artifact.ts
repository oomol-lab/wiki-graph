import { mkdir, rm } from "fs/promises";
import { join } from "path";

import { LanguageCode } from "../../runtime/common/language.js";
import {
  parseMentionLinkRecord,
  parseMentionRecord,
  writeJsonl,
} from "./artifact-io.js";
import type {
  BuildChapterKnowledgeGraphArtifactOptions,
  ChapterKnowledgeGraphBuildArtifact,
} from "./types.js";

export async function buildChapterKnowledgeGraphArtifact(
  chapterId: number,
  options: BuildChapterKnowledgeGraphArtifactOptions,
): Promise<ChapterKnowledgeGraphBuildArtifact> {
  const workspacePath = join(
    options.workspacePath,
    "knowledge-graph",
    `chapter-${chapterId}`,
  );
  const mentionsPath = join(workspacePath, "mentions.jsonl");
  const mentionLinksPath = join(workspacePath, "mention-links.jsonl");

  await rm(workspacePath, { force: true, recursive: true });
  await mkdir(workspacePath, { recursive: true });
  await writeJsonl(mentionsPath, options.mentions, parseMentionRecord);
  await writeJsonl(
    mentionLinksPath,
    options.mentionLinks,
    parseMentionLinkRecord,
  );

  return {
    chapterId,
    mentionLinksPath,
    mentionsPath,
    parameter: options.parameter ?? {
      language: LanguageCode.Chinese,
      prompt: "",
    },
    workspacePath,
  };
}
