import type { Document } from "../document/index.js";
import type { DigestProgressTracker } from "../runtime/progress/index.js";
import { AsyncSemaphore } from "../utils/async-semaphore.js";
import {
  SerialGeneration,
  discoverSerial,
  type GenerateSerialOptions,
  type SerialGenerationOptions,
  writeSerialSource,
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
} from "../text/source/index.js";
import type { ChapterStage } from "./chapter/index.js";

export interface ImportSourceOptions
  extends
    GenerateSerialOptions,
    Omit<SerialGenerationOptions, "document" | "llm"> {
  readonly adapter: SourceAdapter;
  readonly digestProgressTracker?: DigestProgressTracker;
  readonly document: Document;
  readonly llm?: SerialGenerationOptions["llm"];
  readonly path: string;
  readonly targetStage?: ImportSourceStage;
}

export interface ImportedSource {
  readonly cover: SourceAsset | undefined;
  readonly meta: BookMeta;
  readonly serials: readonly ImportedSerial[];
  readonly toc: TocFile;
}

export interface ImportedSerial {
  readonly id: number;
}

export type ImportSourceStage = ChapterStage;

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
  const targetStage = options.targetStage ?? "summarized";
  const generation =
    targetStage === "planned" || targetStage === "sourced"
      ? undefined
      : new SerialGeneration({
          document: options.document,
          llm: requireImportLLM(options.llm, targetStage),
          ...(options.logDirPath === undefined
            ? {}
            : { logDirPath: options.logDirPath }),
          ...(options.segmenter === undefined
            ? {}
            : { segmenter: options.segmenter }),
        });

  if (
    options.digestProgressTracker !== undefined &&
    targetStage !== "planned"
  ) {
    const discoveries = await discoverPlannedSections(plannedSections, {
      ...(options.segmenter === undefined
        ? {}
        : { segmenter: options.segmenter }),
    });

    await options.digestProgressTracker.discoverSerials(discoveries);
  }

  const serials = await generatePlannedSerials(plannedSections, {
    document: options.document,
    extractionPrompt: options.extractionPrompt,
    ...(generation === undefined ? {} : { generation }),
    serialConcurrency: resolveSerialGenerationConcurrency(options.llm),
    targetStage,
    ...(options.digestProgressTracker === undefined
      ? {}
      : { digestProgressTracker: options.digestProgressTracker }),
    ...(options.userLanguage === undefined
      ? {}
      : { userLanguage: options.userLanguage }),
  });

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

async function generatePlannedSerials(
  plannedSections: readonly PlannedSection[],
  options: {
    readonly digestProgressTracker?: DigestProgressTracker;
    readonly document: Document;
    readonly extractionPrompt: string;
    readonly generation?: SerialGeneration;
    readonly serialConcurrency: number;
    readonly targetStage: ImportSourceStage;
    readonly userLanguage?: GenerateSerialOptions["userLanguage"];
  },
): Promise<ImportedSerial[]> {
  if (options.targetStage === "planned") {
    await options.document.openSession(async (document) => {
      for (const plannedSection of plannedSections) {
        await document.serials.createWithId(plannedSection.serialId);
      }
    });

    return plannedSections.map((plannedSection) => ({
      id: plannedSection.serialId,
    }));
  }

  const limiter = new AsyncSemaphore(options.serialConcurrency);
  const serials = await Promise.all(
    plannedSections.map(async (plannedSection) => {
      return await limiter.use(async () => {
        const context = options.document.createContext();

        context.ownSerial(plannedSection.serialId);

        try {
          const serialProgressTracker =
            options.digestProgressTracker?.createSerialTracker({
              id: plannedSection.serialId,
            });
          const serial = await context.run(async () => {
            if (options.targetStage === "sourced") {
              await options.document.serials.createWithId(
                plannedSection.serialId,
              );
              await writeSerialSource(
                options.document,
                plannedSection.serialId,
                await plannedSection.section.open(),
              );

              return {
                id: plannedSection.serialId,
              } satisfies ImportedSerial;
            }

            if (options.targetStage === "graphed") {
              await options.document.serials.createWithId(
                plannedSection.serialId,
              );
              await writeSerialSource(
                options.document,
                plannedSection.serialId,
                await plannedSection.section.open(),
              );
              await requireSerialGeneration(
                options.generation,
                options.targetStage,
              ).buildTopologyInto(
                plannedSection.serialId,
                {
                  extractionPrompt: options.extractionPrompt,
                  ...(options.userLanguage === undefined
                    ? {}
                    : { userLanguage: options.userLanguage }),
                },
                serialProgressTracker,
              );

              return {
                id: plannedSection.serialId,
              } satisfies ImportedSerial;
            }

            return await requireSerialGeneration(
              options.generation,
              options.targetStage,
            ).generateInto(
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

          context.complete();
          return serial;
        } finally {
          await context.dispose();
        }
      });
    }),
  );

  return [...serials].sort((left, right) => left.id - right.id);
}

function planTocItems(input: {
  readonly fallbackTitle: string | null | undefined;
  readonly plannedSections: PlannedSection[];
  readonly sections: readonly SourceSection[];
  readonly serialIdAllocator: SerialIdAllocator;
}): TocItem[] {
  return input.sections.map((section, index) =>
    planTocItem({
      fallbackTitle:
        input.sections.length === 1 ? input.fallbackTitle : undefined,
      indexPath: [index],
      plannedSections: input.plannedSections,
      section,
      serialIdAllocator: input.serialIdAllocator,
    }),
  );
}

function planTocItem(input: {
  readonly fallbackTitle: string | null | undefined;
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
      fallbackTitle: undefined,
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

  const title =
    normalizeTitle(input.section.title) ?? normalizeTitle(input.fallbackTitle);

  return {
    ...(title === undefined ? {} : { title }),
    ...(serialId === undefined ? {} : { serialId }),
    children,
  };
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
    throw new Error("Archive metadata already exists");
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
    readonly title?: string | undefined;
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
      title: plannedSection.section.title?.trim() || undefined,
      words: plannedSection.section.wordsCount ?? 0,
    }));
  }

  const discoveries = [];

  for (const plannedSection of plannedSections) {
    discoveries.push({
      id: plannedSection.serialId,
      title: plannedSection.section.title?.trim() || undefined,
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

function resolveSerialGenerationConcurrency(
  llm: Pick<ImportSourceOptions, "llm">["llm"],
): number {
  if (
    typeof llm !== "object" ||
    llm === null ||
    !("config" in llm) ||
    typeof llm.config !== "object" ||
    llm.config === null ||
    !("concurrent" in llm.config) ||
    typeof llm.config.concurrent !== "number" ||
    !Number.isInteger(llm.config.concurrent) ||
    llm.config.concurrent < 1
  ) {
    return 1;
  }

  return llm.config.concurrent;
}

function requireImportLLM(
  llm: ImportSourceOptions["llm"],
  targetStage: ImportSourceStage,
): NonNullable<ImportSourceOptions["llm"]> {
  if (llm === undefined) {
    throw new Error(`LLM is required to import source to ${targetStage}.`);
  }

  return llm;
}

function requireSerialGeneration(
  generation: SerialGeneration | undefined,
  targetStage: ImportSourceStage,
): SerialGeneration {
  if (generation === undefined) {
    throw new Error(
      `Internal error: serial generation is required for ${targetStage}.`,
    );
  }

  return generation;
}
