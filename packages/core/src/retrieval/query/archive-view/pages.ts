import type { ReadonlyDocument } from "../../../document/index.js";
import {
  getChapterTree,
  listChapters,
} from "../../../document/chapter/index.js";
import { listGraphNeighbors } from "../../../graph/reading.js";
import type { WikipageResolverOptions } from "../../../external/wikipage/index.js";

import {
  ARCHIVE_ROOT_ID,
  createMetaPage,
  formatMetaText,
  isWikiGraphObjectUri,
  normalizeWikiGraphObjectUri,
  createNodePosition,
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
  createMentionEvidencePreview,
  createMentionLinkEvidencePreview,
} from "./source.js";
import { createTextStreamBacklinks } from "./backlinks.js";
import {
  createTriplePageLabel,
  filterMentionLinksByChapter,
  filterMentionsByChapter,
  selectEntityLabel,
  selectEntityLabels,
} from "./knowledge.js";
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
  readonly sourceContext?: number;
  readonly wikipageResolverOptions?: WikipageResolverOptions;
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
  const [base = "", hash] = uri.split("#", 2);
  const prefix = "wikg://chapter/";

  if (!base.startsWith(prefix) || base === "wikg://chapter/tree") {
    return uri;
  }

  const path = base.slice(prefix.length);
  const chapter = (await listChapters(document))
    .slice()
    .sort((left, right) => right.path.length - left.path.length)
    .find((entry) => path === entry.path || path.startsWith(`${entry.path}/`));

  if (chapter === undefined) {
    return uri;
  }

  const suffix = path.slice(chapter.path.length);
  const resolved = `${prefix}${chapter.chapterId}${suffix}`;
  return hash === undefined ? resolved : `${resolved}#${hash}`;
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
    case "meta":
      return await readArchivePage(document, ARCHIVE_ROOT_ID, options);
    case "chapter":
      throw new Error(
        `${displayUri} is a scope URI, not a readable object. Use ${displayUri}/title or ${displayUri}/state.`,
      );
    case "chapter-title":
      return await readArchivePage(
        document,
        formatChapterTitleId(reference.chapterId),
        options,
      );
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
      const mentions = filterMentionsByChapter(
        await document.mentions.listByQid(reference.qid),
        reference.chapterId,
      );

      if (mentions.length === 0) {
        throw new Error(`Entity ${uri} was not found in this archive.`);
      }

      return {
        evidence: await createMentionEvidencePreview(
          document,
          mentions,
          options.evidenceLimit,
          createEvidenceReadContext(),
          options.sourceContext ?? DEFAULT_SOURCE_CONTEXT,
          options.order ?? "doc-asc",
        ),
        id: displayUri,
        label: selectEntityLabel(mentions),
        labels: selectEntityLabels(mentions),
        mentionCount: mentions.length,
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
      const links = await filterMentionLinksByChapter(
        document,
        await document.mentionLinks.listByTriple({
          objectQid: reference.objectQid,
          predicate: reference.predicate,
          subjectQid: reference.subjectQid,
        }),
        reference.chapterId,
      );

      if (links.length === 0) {
        throw new Error(`Triple ${uri} was not found in this archive.`);
      }

      return {
        evidence: await createMentionLinkEvidencePreview(
          document,
          links,
          options.evidenceLimit,
          createEvidenceReadContext(),
          options.sourceContext ?? DEFAULT_SOURCE_CONTEXT,
          options.order ?? "doc-asc",
        ),
        id: displayUri,
        label: await createTriplePageLabel(document, reference),
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
      const fragment = await createTextStreamRangeFragment(document, reference);
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
