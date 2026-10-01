import {
  listChapters,
  parseLocatedWikiGraphUri,
  resolveChapterPathReadonly,
  type ChapterEntry,
  type ReadonlyDocument,
} from "wiki-graph-sdk";

import type { CLIArchiveArguments } from "../../../args/index.js";

export interface ChapterScopeResolution {
  readonly chapterIds: readonly number[];
  readonly entries: readonly ChapterEntry[];
}

export async function resolveArchiveChapterScope(
  document: ReadonlyDocument,
  args: Pick<CLIArchiveArguments, "archivePath" | "depth">,
): Promise<ChapterScopeResolution | undefined> {
  const objectUri = parseLocatedWikiGraphUri(args.archivePath).objectUri;

  if (objectUri === undefined) {
    return undefined;
  }

  const scope = parseChapterScopePath(objectUri);
  if (scope === undefined) {
    return undefined;
  }
  if (scope.kind === "collection" && args.depth === undefined) {
    return undefined;
  }

  const chapters = await listChapters(document);
  const entries =
    scope.kind === "collection"
      ? selectRootChapterScope(chapters, args.depth)
      : selectChapterSubtreeScope(
          chapters,
          await resolveChapterPathReadonly(document, scope.chapterPath),
          args.depth,
        );

  return {
    chapterIds: entries.map((entry) => entry.chapterId),
    entries,
  };
}

function parseChapterScopePath(
  objectUri: string,
):
  | { readonly kind: "collection" }
  | { readonly chapterPath: string; readonly kind: "chapter" }
  | undefined {
  if (objectUri === "wikg://chapter" || objectUri === "wikg://chapter/") {
    return { kind: "collection" };
  }

  const match = /^wikg:\/\/chapter\/([^/].*?)(?:\/)?$/u.exec(objectUri);
  if (match?.[1] === undefined) {
    return undefined;
  }

  return { chapterPath: decodeURIComponent(match[1]), kind: "chapter" };
}

export function selectRootChapterScope(
  chapters: readonly ChapterEntry[],
  depth: number | undefined,
): readonly ChapterEntry[] {
  return depth === undefined
    ? chapters
    : chapters.filter((chapter) => chapter.depth <= depth);
}

export function selectChapterSubtreeScope(
  chapters: readonly ChapterEntry[],
  rootChapterId: number,
  depth: number | undefined,
): readonly ChapterEntry[] {
  const root = chapters.find((chapter) => chapter.chapterId === rootChapterId);
  if (root === undefined) {
    throw new Error(`Chapter ${rootChapterId} does not exist.`);
  }

  const prefix = `${root.path}/`;
  return chapters.filter((chapter) => {
    if (chapter.chapterId === root.chapterId) {
      return true;
    }
    if (!chapter.path.startsWith(prefix)) {
      return false;
    }
    return depth === undefined || chapter.depth - root.depth <= depth;
  });
}
