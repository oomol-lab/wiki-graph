import type { SourceAdapter, SourceDocument } from "../adapter.js";
import type { SourceAsset, SourceSection, SourceTextStream } from "../types.js";
import { normalizeFragment } from "./archive.js";
import { EpubArchive } from "./archive.js";
import {
  analyzeSectionTargets,
  EpubContentLoader,
  type EpubSectionAnalysis,
  type EpubSectionTarget,
} from "./content.js";
import { readEpubNavigation, type EpubNavigationItem } from "./navigation.js";
import { readEpubPackage, type EpubPackageData } from "./package.js";

interface SectionDefinition {
  readonly hasContent: boolean;
  readonly id: string;
  readonly title: string | undefined;
  readonly path: string | undefined;
  readonly fragment: string | undefined;
  readonly wordsCount: number;
  readonly children: readonly SectionDefinition[];
}

class EpubSourceSection implements SourceSection {
  readonly #document: EpubSourceDocument;
  readonly #definition: SectionDefinition;

  public constructor(
    document: EpubSourceDocument,
    definition: SectionDefinition,
  ) {
    this.#document = document;
    this.#definition = definition;
  }

  public get id(): string {
    return this.#definition.id;
  }

  public get hasContent(): boolean {
    return this.#definition.hasContent;
  }

  public get title(): string | undefined {
    return this.#definition.title;
  }

  public get wordsCount(): number {
    return this.#definition.wordsCount;
  }

  public get children(): readonly SourceSection[] {
    return this.#definition.children.map(
      (child) => new EpubSourceSection(this.#document, child),
    );
  }

  public async open(): Promise<SourceTextStream> {
    return await this.#document.openSection(this.#definition.id);
  }
}

export class EpubSourceDocument implements SourceDocument {
  readonly #packageData: EpubPackageData;
  readonly #cover: SourceAsset | undefined;
  readonly #sections: readonly SectionDefinition[];
  readonly #contentLoader: EpubContentLoader;

  public constructor(
    packageData: EpubPackageData,
    cover: SourceAsset | undefined,
    sections: readonly SectionDefinition[],
    contentLoader: EpubContentLoader,
  ) {
    this.#packageData = packageData;
    this.#cover = cover;
    this.#sections = sections;
    this.#contentLoader = contentLoader;
  }

  public static async open(archive: EpubArchive): Promise<EpubSourceDocument> {
    assertArchiveIsSupported(archive);
    const packageData = await readEpubPackage(archive);
    const navigation = await readEpubNavigation(archive, packageData);
    const rawSections = buildSections(archive, navigation);
    const targetsByPath = groupTargetsByPath(rawSections);
    const sectionAnalyses = await analyzeSectionTargets(archive, targetsByPath);
    const sections = hydrateSectionAnalyses(rawSections, sectionAnalyses);
    const cover = await readCoverAsset(archive, packageData);

    return new EpubSourceDocument(
      packageData,
      cover,
      sections,
      new EpubContentLoader(archive, targetsByPath),
    );
  }

  public readMeta() {
    return Promise.resolve(this.#packageData.metadata);
  }

  public readCover() {
    return Promise.resolve(this.#cover);
  }

  public readSections() {
    return Promise.resolve(
      this.#sections.map((section) => new EpubSourceSection(this, section)),
    );
  }

  public async openSection(sectionId: string): Promise<SourceTextStream> {
    return await this.#contentLoader.openSection(sectionId);
  }
}

export class EpubSourceAdapter implements SourceAdapter {
  public get format() {
    return "epub" as const;
  }

  public async openSession<T>(
    path: string,
    operation: (document: SourceDocument) => Promise<T>,
  ): Promise<T> {
    const archive = await EpubArchive.open(path);

    try {
      const document = await EpubSourceDocument.open(archive);

      return await operation(document);
    } finally {
      await archive.close();
    }
  }
}

export const EPUB_SOURCE_ADAPTER = new EpubSourceAdapter();

function assertArchiveIsSupported(archive: EpubArchive): void {
  if (!archive.hasEntry("META-INF/encryption.xml")) {
    return;
  }

  throw new Error(
    "Encrypted EPUB is not supported: found META-INF/encryption.xml.",
  );
}

async function readCoverAsset(
  archive: EpubArchive,
  packageData: EpubPackageData,
): Promise<SourceAsset | undefined> {
  if (
    packageData.coverPath === undefined ||
    packageData.coverMediaType === undefined
  ) {
    return undefined;
  }

  return {
    path: packageData.coverPath,
    mediaType: packageData.coverMediaType,
    data: await archive.readBuffer(packageData.coverPath),
  };
}

function buildSections(
  archive: EpubArchive,
  items: readonly EpubNavigationItem[],
): readonly SectionDefinition[] {
  const idCounts = new Map<string, number>();

  return items.map((item, index) =>
    buildSection(archive, item, [index], idCounts),
  );
}

function buildSection(
  archive: EpubArchive,
  item: EpubNavigationItem,
  indexPath: readonly number[],
  idCounts: Map<string, number>,
): SectionDefinition {
  const fragment = normalizeFragment(item.fragment);
  const baseId =
    item.path === undefined
      ? `toc:${indexPath.join(".")}`
      : archive.createSectionId(item.path, fragment);
  const id = createUniqueId(baseId, idCounts);

  return {
    hasContent: item.path !== undefined,
    id,
    title: item.title,
    path: item.path,
    fragment,
    wordsCount: 0,
    children: item.children.map((child, index) =>
      buildSection(archive, child, [...indexPath, index], idCounts),
    ),
  };
}

function hydrateSectionAnalyses(
  sections: readonly SectionDefinition[],
  sectionAnalyses: ReadonlyMap<string, EpubSectionAnalysis>,
): readonly SectionDefinition[] {
  return sections.map((section) => {
    const analysis = sectionAnalyses.get(section.id);

    return {
      ...section,
      hasContent: analysis?.hasContent ?? false,
      wordsCount: analysis?.wordsCount ?? 0,
      children: hydrateSectionAnalyses(section.children, sectionAnalyses),
    };
  });
}

function createUniqueId(baseId: string, idCounts: Map<string, number>): string {
  const currentCount = idCounts.get(baseId) ?? 0;
  idCounts.set(baseId, currentCount + 1);

  return currentCount === 0 ? baseId : `${baseId}~${currentCount + 1}`;
}

function groupTargetsByPath(
  sections: readonly SectionDefinition[],
): ReadonlyMap<string, readonly EpubSectionTarget[]> {
  const targetsByPath = new Map<string, EpubSectionTarget[]>();

  for (const section of flattenSections(sections)) {
    if (section.path === undefined) {
      continue;
    }

    const targets = targetsByPath.get(section.path) ?? [];
    targets.push({
      id: section.id,
      path: section.path,
      fragment: section.fragment,
    });
    targetsByPath.set(section.path, targets);
  }

  return targetsByPath;
}

function flattenSections(
  sections: readonly SectionDefinition[],
): readonly SectionDefinition[] {
  const flattened: SectionDefinition[] = [];

  for (const section of sections) {
    flattened.push(section);
    flattened.push(...flattenSections(section.children));
  }

  return flattened;
}
