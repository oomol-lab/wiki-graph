import type {
  AnyChapterJobArtifact,
  ChapterJobArtifact,
  JobObject,
} from "wiki-graph-job";

import type { Document } from "../../document/index.js";
import {
  commitChapterKnowledgeGraphArtifact,
  type GraphBuildParameterInput as KnowledgeGraphParameter,
} from "../../graph/knowledge-build/index.js";
import {
  commitChapterGraphArtifact,
  type GraphBuildParameterInput as ReadingGraphParameter,
} from "../../graph/reading-build/index.js";
import {
  parseWikgObject,
  writeWikgObjectsToJsonl,
} from "../../object-stream.js";
import {
  ensureRelativeDirectory,
  ensureRelativeFile,
  type Directory,
} from "../../runtime/platform/index.js";
import { commitChapterSummaryArtifact } from "../../text/summary-build/index.js";

export async function commitChapterJobArtifact(
  document: Document,
  artifact: AnyChapterJobArtifact,
  workspace: Directory,
): Promise<void> {
  switch (artifact.kind) {
    case "index-fts":
      await document.indexArtifacts.replaceFts({
        lexicalRows: artifact.payload.lexicalRows,
        metadata: artifact.payload.metadata,
        serialId: artifact.chapterId,
        sourceRevision: artifact.revision,
      });
      return;
    case "index-embedding-source":
    case "index-embedding-summary":
      await document.indexArtifacts.replaceEmbedding({
        kind: artifact.payload.kind,
        metadata: artifact.payload.metadata,
        segments: artifact.payload.segments,
        serialId: artifact.chapterId,
        sourceRevision: artifact.revision,
      });
      return;
    case "reading-summary":
      await commitChapterSummaryArtifact(
        document,
        artifact.chapterId,
        artifact.payload.summary,
      );
      return;
    case "reading-graph":
      await commitReadingGraph(document, artifact, workspace);
      return;
    case "knowledge-graph":
      await commitKnowledgeGraph(document, artifact, workspace);
      return;
  }
}

async function commitReadingGraph(
  document: Document,
  artifact: ChapterJobArtifact<"reading-graph">,
  workspace: Directory,
): Promise<void> {
  const objectsFile = await ensureRelativeFile(
    workspace,
    "reading-graph-output.jsonl",
  );
  await writeWikgObjectsToJsonl(
    objectsFile,
    artifact.payload.objects.map(parseJobObject),
  );
  await commitChapterGraphArtifact(document, {
    chapterId: artifact.chapterId,
    documentDirectory: await ensureRelativeDirectory(
      workspace,
      "reading-graph-document",
    ),
    objectsFile,
    parameter: readParameter(artifact.payload.objects, "reading-graph"),
  });
}

async function commitKnowledgeGraph(
  document: Document,
  artifact: ChapterJobArtifact<"knowledge-graph">,
  workspace: Directory,
): Promise<void> {
  const artifactWorkspace = await ensureRelativeDirectory(
    workspace,
    "knowledge-graph-output",
  );
  const objectsFile = await ensureRelativeFile(
    artifactWorkspace,
    "objects.jsonl",
  );
  await writeWikgObjectsToJsonl(
    objectsFile,
    artifact.payload.objects.map(parseJobObject),
  );
  await commitChapterKnowledgeGraphArtifact(document, {
    chapterId: artifact.chapterId,
    mentionLinksFile: await ensureRelativeFile(
      artifactWorkspace,
      "mention-links.jsonl",
    ),
    mentionsFile: await ensureRelativeFile(
      artifactWorkspace,
      "mentions.jsonl",
    ),
    objectsFile,
    parameter: readParameter(
      artifact.payload.objects,
      "knowledge-graph",
    ),
    workspace: artifactWorkspace,
  });
}

function parseJobObject(object: JobObject) {
  return parseWikgObject(object);
}

function readParameter(
  objects: readonly JobObject[],
  scope: "knowledge-graph",
): KnowledgeGraphParameter;
function readParameter(
  objects: readonly JobObject[],
  scope: "reading-graph",
): ReadingGraphParameter;
function readParameter(
  objects: readonly JobObject[],
  scope: "knowledge-graph" | "reading-graph",
): KnowledgeGraphParameter | ReadingGraphParameter {
  const parameter = objects.find(
    (object) => object.type === "parameter" && object.scope === scope,
  );
  return parameter?.type === "parameter"
    ? {
        ...(parameter.language === undefined
          ? {}
          : { language: parameter.language }),
        prompt: parameter.prompt,
      }
    : { prompt: "" };
}
