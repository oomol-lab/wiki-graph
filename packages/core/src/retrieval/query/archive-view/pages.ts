import {
  formatSourceArtifactUri,
  parseSourceLocatorFragment,
  type ReadonlyDocument,
} from "../../../document/index.js";
import { parseWikiGraphUriSyntax } from "../../../runtime/common/wiki-graph/uri.js";
import {
  getChapterTree,
  listChapters,
} from "../../../document/chapter/index.js";
import { listGraphNeighbors } from "../../../graph/reading.js";
import type { WikimediaResolver } from "../../../external/wikipage/index.js";

import {
  ARCHIVE_ROOT_ID,
  createMetaPage,
  formatMetaText,
  isWikiGraphObjectUri,
  normalizeWikiGraphObjectUri,
  createNodePosition,
  readArchiveTitle,
} from "./helpers.js";
import {
  DEFAULT_SOURCE_CONTEXT,
  createChapterState,
  listFragmentNodes,
  readNodeSourceFragments,
  requireChapter,
  requireNode,
} from "./core.js";
import {
  createEvidenceReadContext,
  createMentionEvidencePagePreview,
  createMentionLinkEvidencePagePreview,
} from "./source.js";
import { createTextStreamBacklinks } from "./backlinks.js";
import { createTriplePageLabel } from "./knowledge.js";
import { resolveEntityWikipage } from "./related/index.js";
import {
  formatChapterId,
  formatChapterTitleId,
  formatFragmentId,
  formatNodeId,
  formatSummaryId,
  parseArchiveReference,
  parseWikiGraphReference,
} from "./references.js";
import {
  createTextStreamRangeFragment,
  readSourceFragment,
  readTextStreamText,
} from "./text-streams.js";
import type { ArchiveFindOrder, ArchivePage } from "./types.js";

export interface ArchivePageOptions {
  readonly backlinks?: boolean;
  readonly evidenceLimit?: number;
  readonly order?: ArchiveFindOrder;
  readonly signal?: AbortSignal;
  readonly sourceContext?: number;
  readonly wikimediaResolver?: WikimediaResolver;
}

export async function readArchiveText(
  document: ReadonlyDocument,
  id: string,
): Promise<string> {
  const reference = parseArchiveReference(id);

  switch (reference.type) {
    case "chapter":
      throw new Error(
        `Chapter ${formatChapterId(reference.id)} is a scope URI, not a readable object.`,
      );
    case "chapter-title": {
      const chapter = await requireChapter(document, reference.id);

      return chapter.title ?? `[chapter ${reference.id}]`;
    }
    case "fragment":
      return (
        await readSourceFragment(
          document,
          reference.serialId,
          reference.fragmentId,
        )
      ).text;
    case "summary": {
      const summary = await readTextStreamText(
        document,
        reference.id,
        "summary",
      );

      if (summary.trim() === "") {
        throw new Error(`Summary ${formatSummaryId(reference.id)} is missing.`);
      }

      return summary;
    }
    case "node": {
      const { node } = await requireNode(document, reference.id);

      return node.content;
    }
    case "meta": {
      return formatMetaText(await document.readBookMeta());
    }
  }
}

export async function readArchivePage(
  document: ReadonlyDocument,
  id: string,
  options: ArchivePageOptions = {},
): Promise<ArchivePage> {
  if (isWikiGraphObjectUri(id)) {
    const normalizedUri = normalizeWikiGraphObjectUri(id);
    return await readWikiGraphPage(
      document,
      await resolveChapterPathObjectUri(document, normalizedUri),
      options,
      normalizedUri,
    );
  }

  const reference = parseArchiveReference(id);

  switch (reference.type) {
    case "chapter": {
      throw new Error(
        `Chapter ${formatChapterId(reference.id)} is a scope URI, not a readable object. Use wikg://chapter/${reference.id}/title or wikg://chapter/${reference.id}/state.`,
      );
    }
    case "chapter-title": {
      const chapter = await requireChapter(document, reference.id);

      return {
        id: formatChapterTitleId(reference.id),
        title: chapter.title ?? `[chapter ${reference.id}]`,
        type: "chapter-title",
      };
    }
    case "fragment": {
      const [fragment, relatedNodes, fragmentIds] = await Promise.all([
        readSourceFragment(document, reference.serialId, reference.fragmentId),
        listFragmentNodes(document, reference.serialId, reference.fragmentId),
        document.getSerialFragments(reference.serialId).listFragmentIds(),
      ]);
      const fragmentIndex = fragmentIds.indexOf(reference.fragmentId);
      const previousFragmentId =
        fragmentIndex > 0 ? fragmentIds[fragmentIndex - 1] : undefined;
      const nextFragmentId =
        fragmentIndex >= 0 && fragmentIndex < fragmentIds.length - 1
          ? fragmentIds[fragmentIndex + 1]
          : undefined;

      return {
        fragment,
        id: fragment.id,
        nextFragmentId:
          nextFragmentId === undefined
            ? undefined
            : formatFragmentId(reference.serialId, nextFragmentId),
        nodes: relatedNodes,
        previousFragmentId:
          previousFragmentId === undefined
            ? undefined
            : formatFragmentId(reference.serialId, previousFragmentId),
        title: fragment.id,
        type: "fragment",
      };
    }
    case "meta":
      return {
        ...createMetaPage(await document.readBookMeta()),
        id: ARCHIVE_ROOT_ID,
        type: "meta",
      };
    case "node": {
      const { chapterId, node } = await requireNode(document, reference.id);
      const [neighbors, sourceFragments] = await Promise.all([
        listGraphNeighbors(document, chapterId, reference.id),
        readNodeSourceFragments(document, node),
      ]);
      const outgoing = neighbors.filter(
        (neighbor) => neighbor.direction === "outgoing",
      );
      const incoming = neighbors.filter(
        (neighbor) => neighbor.direction === "incoming",
      );

      return {
        generatedNodeSummary: node.content,
        id: formatNodeId(node.id),
        incoming,
        neighbors,
        outgoing,
        position: createNodePosition(node.sentenceIds),
        sourceFragments,
        title: node.label,
        type: "node",
      };
    }
    case "summary": {
      const chapter = await requireChapter(document, reference.id);
      const content = await readTextStreamText(
        document,
        reference.id,
        "summary",
      );

      if (content.trim() === "") {
        throw new Error(`Summary ${formatSummaryId(reference.id)} is missing.`);
      }

      return {
        content,
        id: formatSummaryId(reference.id),
        title: chapter.title ?? `[chapter ${reference.id}]`,
        type: "summary",
      };
    }
  }
}

async function resolveChapterPathObjectUri(
  document: ReadonlyDocument,
  uri: string,
): Promise<string> {
  const prefix = "wikg://chapter/";
  const parsed = parseWikiGraphUriSyntax(uri);
  const base = `wikg://${parsed.path.join("/")}`;
  const hash = formatParsedUriFragment(parsed.fragment);

  if (!base.startsWith(prefix) || base === "wikg://chapter/tree") {
    return uri;
  }

  const path = base.slice(prefix.length);
  const chapter = (await listChapters(document))
    .slice()
    .sort((left, right) => right.path.length - left.path.length)
    .find(
      (entry: any) => path === entry.path || path.startsWith(`${entry.path}/`),
    );

  if (chapter === undefined) {
    return uri;
  }

  const suffix = path.slice(chapter.path.length);
  const resolved = `${prefix}${chapter.chapterId}${suffix}`;
  return hash === undefined ? resolved : `${resolved}#${hash}`;
}

function formatParsedUriFragment(
  fragment:
    | number
    | { readonly begin: number; readonly end: number }
    | { readonly raw: string }
    | undefined,
): string | undefined {
  if (fragment === undefined) {
    return undefined;
  }
  if (typeof fragment === "number") {
    return String(fragment);
  }
  if ("raw" in fragment) {
    return fragment.raw;
  }

  return `${fragment.begin}..${fragment.end}`;
}

async function readWikiGraphPage(
  document: ReadonlyDocument,
  uri: string,
  options: ArchivePageOptions = {},
  displayUri = uri,
): Promise<ArchivePage> {
  uri = normalizeWikiGraphObjectUri(uri);
  displayUri = normalizeWikiGraphObjectUri(displayUri);
  const reference = parseWikiGraphReference(uri);

  switch (reference.type) {
    case "archive":
      throw new Error(
        `${displayUri} is a scope URI, not a readable object. Use ${displayUri}title or ${displayUri}meta.`,
      );
    case "archive-title": {
      const title = await readArchiveTitle(document);

      if (title === undefined) {
        throw new Error(`Archive title ${displayUri} is missing.`);
      }
      return { id: displayUri, title, type: "archive-title" };
    }
    case "artifact": {
      const artifact = await document.sourceProvenance.getArtifact(
        reference.artifactReference,
      );
      if (artifact === undefined) {
        throw new Error(
          `Source artifact ${formatSourceArtifactUri(reference.artifactReference)} was not found in this archive.`,
        );
      }

      if (reference.fragment === undefined) {
        return {
          digest: artifact.digest,
          id: formatSourceArtifactUri(artifact.shortUid),
          ...(artifact.identifier === undefined
            ? {}
            : { identifier: artifact.identifier }),
          mediaType: artifact.mediaType,
          ...(artifact.name === undefined ? {} : { name: artifact.name }),
          shortUid: artifact.shortUid,
          type: "artifact",
        };
      }

      const parsedLocator = parseSourceLocatorFragment(reference.fragment);
      if (parsedLocator.mediaType !== artifact.mediaType) {
        throw new Error(
          `Source locator ${reference.fragment} does not match artifact mediaType ${artifact.mediaType}.`,
        );
      }
      const locator = await document.sourceProvenance.getLocator(
        artifact.digest,
        parsedLocator.fragment,
      );
      if (locator === undefined) {
        throw new Error(
          `Source locator ${formatSourceArtifactUri(artifact.shortUid, parsedLocator.fragment)} was not found in this archive.`,
        );
      }

      return {
        digest: artifact.digest,
        id: formatSourceArtifactUri(artifact.shortUid, parsedLocator.fragment),
        ...(artifact.identifier === undefined
          ? {}
          : { identifier: artifact.identifier }),
        locator: locator.locator,
        mediaType: artifact.mediaType,
        ...(artifact.name === undefined ? {} : { name: artifact.name }),
        shortUid: artifact.shortUid,
        type: "artifact",
      };
    }
    case "meta":
      return {
        ...createMetaPage(await document.readBookMeta()),
        id: displayUri,
        type: "meta",
      };
    case "chapter":
      throw new Error(
        `${displayUri} is a scope URI, not a readable object. Use ${displayUri}/title or ${displayUri}/state.`,
      );
    case "chapter-title": {
      const chapter = await requireChapter(document, reference.chapterId);

      return {
        id: displayUri,
        title: chapter.title ?? `[chapter ${chapter.path}]`,
        type: "chapter-title",
      };
    }
    case "chapter-state": {
      const details = await requireChapter(document, reference.chapterId);
      const targets = await createChapterState(document, details);

      return {
        id:
          reference.target === undefined
            ? displayUri
            : `${displayUri.replace(/\/state(?:\/.*)?$/u, "")}/state/${reference.target}`,
        ...(reference.target === undefined
          ? { state: targets }
          : { target: reference.target, value: targets[reference.target] }),
        type: "state",
      };
    }
    case "chapter-tree":
      return {
        id: "chapter-tree",
        title: "Chapter tree",
        tree: await getChapterTree(document),
        type: "chapter-tree",
      };
    case "entity": {
      const evidenceLimit = options.evidenceLimit ?? 3;
      const chapterFilter =
        reference.chapterId === undefined
          ? {}
          : { chapterId: reference.chapterId };
      const [mentionCount, mentions, labels] = await Promise.all([
        document.mentions.countByQid(reference.qid, chapterFilter),
        document.mentions.listByQid(reference.qid, {
          ...chapterFilter,
          limit: evidenceLimit,
          order: options.order === "doc-desc" ? "desc" : "asc",
        }),
        document.mentions.listLabelsByQid(reference.qid, chapterFilter),
      ]);

      if (mentionCount === 0) {
        throw new Error(`Entity ${uri} was not found in this archive.`);
      }

      return {
        evidence: await createMentionEvidencePagePreview(
          document,
          mentions,
          evidenceLimit,
          createEvidenceReadContext(),
          options.sourceContext ?? DEFAULT_SOURCE_CONTEXT,
          mentionCount,
        ),
        id: displayUri,
        label: labels[0] ?? reference.qid,
        labels,
        mentionCount,
        qid: reference.qid,
        type: "entity",
      };
    }
    case "entity-wikipage":
      return {
        ...(await resolveEntityWikipage(reference.qid, options)),
        id: displayUri,
        type: "entity-wikipage",
      };
    case "triple": {
      const evidenceLimit = options.evidenceLimit ?? 3;
      const tripleQuery = {
        ...(reference.chapterId === undefined
          ? {}
          : { chapterId: reference.chapterId }),
        objectQid: reference.objectQid,
        predicate: reference.predicate,
        subjectQid: reference.subjectQid,
      };
      const [linkCount, links, label] = await Promise.all([
        document.mentionLinks.countByTriple(tripleQuery),
        document.mentionLinks.listByTriple({
          ...tripleQuery,
          limit: evidenceLimit,
          order: options.order === "doc-desc" ? "desc" : "asc",
        }),
        createTriplePageLabel(document, reference),
      ]);

      if (linkCount === 0) {
        throw new Error(`Triple ${uri} was not found in this archive.`);
      }

      return {
        evidence: await createMentionLinkEvidencePagePreview(
          document,
          links,
          evidenceLimit,
          createEvidenceReadContext(),
          options.sourceContext ?? DEFAULT_SOURCE_CONTEXT,
          linkCount,
        ),
        id: displayUri,
        label,
        objectQid: reference.objectQid,
        predicate: reference.predicate,
        subjectQid: reference.subjectQid,
        type: "triple",
      };
    }
    case "chunk": {
      if (reference.chapterId !== undefined) {
        const { chapterId } = await requireNode(document, reference.id);

        if (chapterId !== reference.chapterId) {
          throw new Error(`Chunk ${uri} was not found in this archive.`);
        }
      }
      return await readArchivePage(
        document,
        formatNodeId(reference.id),
        options,
      );
    }
    case "text-stream": {
      const { fragment } = await createTextStreamRangeFragment(
        document,
        reference,
      );
      return {
        ...(options.backlinks === true
          ? { backlinks: await createTextStreamBacklinks(document, reference) }
          : {}),
        fragment: { ...fragment, id: displayUri },
        id: displayUri,
        nextFragmentId: undefined,
        nodes: [],
        previousFragmentId: undefined,
        title: displayUri,
        type: "fragment",
      };
    }
  }
}
