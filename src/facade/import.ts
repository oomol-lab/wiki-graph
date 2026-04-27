import type { Document } from "../document/index.js";
import type { DigestProgressTracker } from "../progress/index.js";
import {
  SerialGeneration,
  discoverSerial,
  type GenerateSerialOptions,
  type Serial,
  type SerialGenerationOptions,
} from "../serial.js";
import {
  TOC_FILE_VERSION,
  type BookMeta,
  type SourceAdapter,
  type SourceAsset,
  type SourceDocument,
  type SourceSection,
  type TocFile,
  type TocItem,
} from "../source/index.js";

export interface ImportSourceOptions
  extends GenerateSerialOptions, Omit<SerialGenerationOptions, "document"> {
  readonly adapter: SourceAdapter;
  readonly digestProgressTracker?: DigestProgressTracker;
  readonly document: Document;
  readonly path: string;
}

export interface ImportedSource {
  readonly cover: SourceAsset | undefined;
  readonly meta: BookMeta;
  readonly serials: readonly Serial[];
  readonly toc: TocFile;
}

interface PlannedSection {
  readonly section: SourceSection;
  readonly serialId: number;
}

interface SerialIdAllocator {
  nextSerialId: number;
}

export async function importSource(
  options: ImportSourceOptions,
): Promise<ImportedSource> {
  return await options.adapter.openSession(
    options.path,
    async (sourceDocument) => {
      return await importSourceDocument(sourceDocument, options);
    },
  );
}

export async function importSourceDocument(
  sourceDocument: SourceDocument,
  options: Omit<ImportSourceOptions, "adapter" | "path">,
): Promise<ImportedSource> {
  await assertImportTargetIsEmpty(options.document);

  const meta = await sourceDocument.readMeta();
  const cover = await sourceDocument.readCover();
  const sections = await sourceDocument.readSections();
  const plannedSections: PlannedSection[] = [];
  const serialIdAllocator = {
    nextSerialId: await options.document.peekNextSerialId(),
  } satisfies SerialIdAllocator;
  const toc = {
    version: TOC_FILE_VERSION,
    items: [
      ...planTocItems({
        fallbackTitle: meta.title,
        plannedSections,
        sections,
        serialIdAllocator,
      }),
    ],
  } satisfies TocFile;
  const generation = new SerialGeneration({
    document: options.document,
    llm: options.llm,
    ...(options.logDirPath === undefined
      ? {}
      : { logDirPath: options.logDirPath }),
    ...(options.segmenter === undefined
      ? {}
      : { segmenter: options.segmenter }),
  });
  const serials: Serial[] = [];

  if (options.digestProgressTracker !== undefined) {
    const discoveries = await discoverPlannedSections(plannedSections, {
      ...(options.segmenter === undefined
        ? {}
        : { segmenter: options.segmenter }),
    });

    await options.digestProgressTracker.discoverSerials(discoveries);
  }

  for (const plannedSection of plannedSections) {
    const serialProgressTracker =
      options.digestProgressTracker?.createSerialTracker({
        id: plannedSection.serialId,
      });

    const serial = await options.document.openSession(async () => {
      return await generation.generateInto(
        plannedSection.serialId,
        await plannedSection.section.open(),
        {
          extractionPrompt: options.extractionPrompt,
          ...(options.userLanguage === undefined
            ? {}
            : { userLanguage: options.userLanguage }),
        },
        serialProgressTracker,
      );
    });

    serials.push(serial);
  }

  await options.document.openSession(async (document) => {
    await document.writeBookMeta(meta);
    await document.writeToc(toc);

    if (cover !== undefined) {
      await document.writeCover(cover);
    }
  });

  return {
    cover,
    meta,
    serials,
    toc,
  };
}

function planTocItems(input: {
  readonly fallbackTitle: string | null;
  readonly plannedSections: PlannedSection[];
  readonly sections: readonly SourceSection[];
  readonly serialIdAllocator: SerialIdAllocator;
}): TocItem[] {
  return input.sections.map((section, index) =>
    planTocItem({
      fallbackTitle:
        input.sections.length === 1
          ? input.fallbackTitle
          : createSectionFallbackTitle([index]),
      indexPath: [index],
      plannedSections: input.plannedSections,
      section,
      serialIdAllocator: input.serialIdAllocator,
    }),
  );
}

function planTocItem(input: {
  readonly fallbackTitle: string | null;
  readonly indexPath: readonly number[];
  readonly plannedSections: PlannedSection[];
  readonly section: SourceSection;
  readonly serialIdAllocator: SerialIdAllocator;
}): TocItem {
  const serialId = input.section.hasContent
    ? input.serialIdAllocator.nextSerialId++
    : undefined;
  const children = input.section.children.map((child, index) =>
    planTocItem({
      fallbackTitle: createSectionFallbackTitle([...input.indexPath, index]),
      indexPath: [...input.indexPath, index],
      plannedSections: input.plannedSections,
      section: child,
      serialIdAllocator: input.serialIdAllocator,
    }),
  );

  if (serialId !== undefined) {
    input.plannedSections.push({
      section: input.section,
      serialId,
    });
  }

  return {
    title:
      normalizeTitle(input.section.title) ??
      normalizeTitle(input.fallbackTitle) ??
      createSectionFallbackTitle(input.indexPath),
    ...(serialId === undefined ? {} : { serialId }),
    children,
  };
}

function createSectionFallbackTitle(indexPath: readonly number[]): string {
  return `Section ${indexPath.map((value) => value + 1).join(".")}`;
}

function normalizeTitle(title: string | null | undefined): string | undefined {
  const normalized = title?.trim();

  return normalized === undefined || normalized === "" ? undefined : normalized;
}

async function assertImportTargetIsEmpty(document: Document): Promise<void> {
  const [bookMeta, cover, toc, serialIds] = await Promise.all([
    document.readBookMeta(),
    document.readCover(),
    document.readToc(),
    document.serials.listIds(),
  ]);

  if (bookMeta !== undefined) {
    throw new Error("Document book meta already exists");
  }
  if (cover !== undefined) {
    throw new Error("Document cover already exists");
  }
  if (toc !== undefined) {
    throw new Error("Document TOC already exists");
  }
  if (serialIds.length > 0) {
    throw new Error("Document already contains serials");
  }
}

async function discoverPlannedSections(
  plannedSections: readonly PlannedSection[],
  options: {
    readonly segmenter?: NonNullable<ImportSourceOptions["segmenter"]>;
  },
): Promise<
  readonly {
    readonly fragments?: number;
    readonly id: number;
    readonly words: number;
  }[]
> {
  if (
    plannedSections.every(
      (plannedSection) => plannedSection.section.wordsCount !== undefined,
    )
  ) {
    return plannedSections.map((plannedSection) => ({
      id: plannedSection.serialId,
      words: plannedSection.section.wordsCount ?? 0,
    }));
  }

  const discoveries = [];

  for (const plannedSection of plannedSections) {
    discoveries.push({
      id: plannedSection.serialId,
      ...(await discoverSerial({
        ...(options.segmenter === undefined
          ? {}
          : { segmenter: options.segmenter }),
        stream: await plannedSection.section.open(),
      })),
    });
  }

  return discoveries;
}
