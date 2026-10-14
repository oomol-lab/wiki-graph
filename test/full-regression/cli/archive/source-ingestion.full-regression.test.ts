import { createHash } from "crypto";
import { readFile } from "fs/promises";
import { resolve } from "path";

import { describe, expect, it } from "vitest";
import {
  formatLocatedChapterResourceUri,
  formatWikiGraphCommandUri,
  WikiGraphArchiveFile,
  type SourceTextMapRecord,
} from "wiki-graph-core";
import { runWikiGraphCLICaptured } from "../../../../packages/cli/src/index.js";
import { NodeFile } from "../../../../packages/cli/src/runtime/node-platform.js";

import { withTempDir } from "../../../helpers/temp.js";

const NEWTON_JSONL_PATH = resolve("test/fixtures/sources/newton.pdf.jsonl");
const LITTLE_PRINCE_EPUB_PATH = resolve(
  "test/fixtures/sources/the-little-prince.epub",
);
const LITTLE_PRINCE_JSONL_PATH = resolve(
  "test/fixtures/sources/the-little-prince.epub.jsonl",
);

interface SourceTextRecord {
  readonly locator: Readonly<Record<string, unknown>>;
  readonly text: string;
  readonly type: "text";
}

interface SourceArtifactRecord {
  readonly digest: string;
  readonly mediaType: string;
  readonly name?: string;
  readonly type: "artifact";
}

type SourceJsonlRecord = SourceArtifactRecord | SourceTextRecord;

interface SerialSnapshot {
  readonly maps: readonly SourceTextMapRecord[];
  readonly serialId: number;
  readonly text: string;
}

interface TocItemLike {
  readonly children: readonly TocItemLike[];
  readonly serialId?: number | undefined;
}

describe("cli/archive/source-ingestion", () => {
  it("lists source locators separately and opens their artifact URIs", async () => {
    const digest = "a".repeat(64);
    const shortUid = digest.slice(0, 12);
    const firstText = "😀 First source sentence. ";
    const secondText = "Second source sentence.";
    const secondStart = Array.from(firstText).length;
    const jsonl = [
      JSON.stringify({
        digest,
        mediaType: "application/pdf",
        name: "two-pages.pdf",
        type: "artifact",
      }),
      JSON.stringify({
        locator: { bbox: [0, 0, 0.5, 0.5], pageIndex: 1 },
        text: firstText,
        type: "text",
      }),
      JSON.stringify({
        locator: { bbox: [0.5, 0.5, 1, 1], pageIndex: 2 },
        text: secondText,
        type: "text",
      }),
    ].join("\n");

    await withTempDir("wikigraph-cli-source-provenance-", async (path) => {
      const stateDir = resolve(path, "state");
      const archivePath = resolve(path, "provenance.wikg");
      const archiveUri = formatWikiGraphCommandUri(archivePath);

      await runJsonCLI(stateDir, [archiveUri, "create", "--json"]);
      const chapter = await runJsonCLI(stateDir, [
        `${archiveUri}/chapter`,
        "add",
        "--title",
        "Provenance",
        "--json",
      ]);
      expect(chapter.uri).toMatch(/^wikg:\/\/chapter\//u);
      const locatedChapterUri = requireString(chapter, "locatedUri");
      expect(locatedChapterUri).toBe(
        `${archiveUri}/chapter/${requireChapterPath(chapter)}`,
      );

      const sourceUri = `${locatedChapterUri}/source`;
      await runJsonCLI(
        stateDir,
        [sourceUri, "set", "--input", "-", "--input-format", "jsonl", "--json"],
        jsonl,
      );

      const wholeSource = await runJsonCLI(stateDir, [sourceUri, "--json"]);
      const firstLocator = `wikg://artifact/${shortUid}#page=1&bbox=0,0,0.5,0.5`;
      const secondLocator = `wikg://artifact/${shortUid}#page=2&bbox=0.5,0.5,1,1`;
      expect(wholeSource).not.toHaveProperty("locators");
      const wholePlain = await runWikiGraphCLICaptured({
        argv: [sourceUri],
        stateDir,
      });
      expect(wholePlain.exitCode, wholePlain.stderr).toBe(0);
      expect(wholePlain.stdout).toBe(`${firstText}${secondText}\n`);

      const locatorScopeUri = `${sourceUri}/locators`;
      const firstLocatorPage = await runJsonCLI(stateDir, [
        locatorScopeUri,
        "--limit",
        "1",
        "--json",
      ]);
      expect(firstLocatorPage.objects).toStrictEqual([
        { range: [1, secondStart], uri: firstLocator },
      ]);
      const nextCursor = requireString(firstLocatorPage, "nextCursor");
      const secondLocatorPage = await runJsonCLI(stateDir, [
        "next",
        nextCursor,
        "--json",
      ]);
      expect(secondLocatorPage.objects).toStrictEqual([
        {
          range: [secondStart + 1, secondStart + Array.from(secondText).length],
          uri: secondLocator,
        },
      ]);
      expect(secondLocatorPage.nextCursor).toBeNull();

      const secondRangeLocators = await runJsonCLI(stateDir, [
        `${locatorScopeUri}#2`,
        "--json",
      ]);
      expect(secondRangeLocators.objects).toStrictEqual([
        {
          range: [1, Array.from(secondText).length],
          uri: secondLocator,
        },
      ]);

      const artifact = await runJsonCLI(stateDir, [
        `${archiveUri}/artifact/${digest}`,
        "--json",
      ]);
      expect(artifact).toMatchObject({
        digest,
        mediaType: "application/pdf",
        name: "two-pages.pdf",
        shortUid,
        uri: `wikg://artifact/${shortUid}`,
      });
      const locator = await runJsonCLI(stateDir, [
        `${archiveUri}/artifact/${digest}#page=1&bbox=0,0,0.5,0.5`,
        "--json",
      ]);
      expect(locator).toMatchObject({
        locator: { bbox: [0, 0, 0.5, 0.5], pageIndex: 1 },
        uri: firstLocator,
      });
      await expect(
        runJsonCLI(stateDir, [
          `${archiveUri}/artifact/${shortUid}#page=1&bbox=0,0,0.5,0.5`,
          "--json",
        ]),
      ).resolves.toMatchObject({ digest, shortUid, uri: firstLocator });
      const unassignedPrefix = await runWikiGraphCLICaptured({
        argv: [`${archiveUri}/artifact/${digest.slice(0, 13)}`, "--json"],
        stateDir,
      });
      expect(unassignedPrefix.exitCode).toBe(1);

      const plain = await runWikiGraphCLICaptured({
        argv: [`${sourceUri}#2`],
        stateDir,
      });
      expect(plain.exitCode, plain.stderr).toBe(0);
      expect(plain.stdout).toBe(
        `@@ ${requireString(wholeSource, "uri")}#2 @@\n${secondText}\n`,
      );
      const jsonlResult = await runWikiGraphCLICaptured({
        argv: [`${sourceUri}#1`, "--jsonl"],
        stateDir,
      });
      expect(jsonlResult.exitCode, jsonlResult.stderr).toBe(0);
      expect(JSON.parse(jsonlResult.stdout)).toMatchObject({ text: firstText });
      expect(JSON.parse(jsonlResult.stdout)).not.toHaveProperty("locators");

      const locatorPlain = await runWikiGraphCLICaptured({
        argv: [locatorScopeUri, "--all"],
        stateDir,
      });
      expect(locatorPlain.exitCode, locatorPlain.stderr).toBe(0);
      expect(locatorPlain.stdout).toBe(
        `1..${secondStart} -> ${firstLocator}\n${secondStart + 1}..${secondStart + Array.from(secondText).length} -> ${secondLocator}\n`,
      );

      const locatorJsonl = await runWikiGraphCLICaptured({
        argv: [`${locatorScopeUri}#1`, "--jsonl"],
        stateDir,
      });
      expect(locatorJsonl.exitCode, locatorJsonl.stderr).toBe(0);
      expect(
        locatorJsonl.stdout
          .trim()
          .split("\n")
          .map((line): unknown => JSON.parse(line) as unknown),
      ).toEqual([
        { range: [1, secondStart], uri: firstLocator },
        { nextCursor: null, type: "page" },
      ]);

      await runJsonCLI(stateDir, [
        locatedChapterUri,
        "reset",
        "--to",
        "planned",
        "--json",
      ]);
      await runJsonCLI(stateDir, [sourceUri, "set", "Plain source.", "--json"]);
      const plainSource = await runJsonCLI(stateDir, [sourceUri, "--json"]);
      expect(plainSource).not.toHaveProperty("locators");
      const emptyLocators = await runJsonCLI(stateDir, [
        locatorScopeUri,
        "--json",
      ]);
      expect(emptyLocators.objects).toStrictEqual([]);
      const staleNext = await runWikiGraphCLICaptured({
        argv: ["next", nextCursor, "--json"],
        stateDir,
      });
      expect(staleNext.exitCode).not.toBe(0);
      expect(JSON.parse(staleNext.stdout)).toMatchObject({
        error: { message: "Invalid or stale source locator cursor." },
      });
    });
  });

  it("sets a PDF source from JSONL through real CLI stdin", async () => {
    const jsonl = await readFile(NEWTON_JSONL_PATH, "utf8");
    const records = parseJsonl(jsonl);
    const artifact = requireArtifact(records);
    const textRecords = records.filter(isTextRecord);
    const expectedText = textRecords.map((record) => record.text).join("");

    await withTempDir("wikigraph-cli-pdf-set-", async (path) => {
      const stateDir = resolve(path, "state");
      const archivePath = resolve(path, "newton.wikg");
      const archiveUri = formatWikiGraphCommandUri(archivePath);

      await runJsonCLI(stateDir, [archiveUri, "create", "--json"]);
      const chapter = await runJsonCLI(stateDir, [
        `${archiveUri}/chapter`,
        "add",
        "--title",
        "Newton",
        "--json",
      ]);
      const chapterUri = formatLocatedChapterResourceUri(
        archivePath,
        requireChapterPath(chapter),
        "source",
      );

      await runJsonCLI(
        stateDir,
        [
          chapterUri,
          "set",
          "--input",
          "-",
          "--input-format",
          "jsonl",
          "--json",
        ],
        jsonl,
      );

      const serial = await readSingleSerial(archivePath);
      expect(serial.text).toBe(expectedText);
      expect(serial.maps).toHaveLength(textRecords.length);
      expect(serial.maps[0]?.sourceStart).toBe(0);
      expect(serial.maps.at(-1)?.sourceEnd).toBe(
        Array.from(expectedText).length,
      );
      expect(
        serial.maps.every(
          (mapping) => mapping.artifact.mediaType === artifact.mediaType,
        ),
      ).toBe(true);
      expect(
        serial.maps.every((mapping) => mapping.artifact.name === artifact.name),
      ).toBe(true);
      expect(
        serial.maps.every(
          (mapping, index) =>
            index === 0 ||
            mapping.sourceStart === serial.maps[index - 1]!.sourceEnd,
        ),
      ).toBe(true);
      expect(
        textRecords.every((record) => {
          const pageIndex = record.locator.pageIndex;
          const bbox = record.locator.bbox;
          return (
            Number.isInteger(pageIndex) &&
            (pageIndex as number) >= 1 &&
            Array.isArray(bbox) &&
            bbox.length === 4
          );
        }),
      ).toBe(true);
    });
  });

  it("creates an EPUB archive with native import provenance", async () => {
    const epubDigest = createHash("sha256")
      .update(await readFile(LITTLE_PRINCE_EPUB_PATH))
      .digest("hex");
    const epubShortUid = epubDigest.slice(0, 12);
    const generatedJsonl = parseJsonl(
      await readFile(LITTLE_PRINCE_JSONL_PATH, "utf8"),
    );
    const generatedTextRecords = generatedJsonl.filter(isTextRecord);
    const generatedText = generatedTextRecords
      .map((record) => record.text)
      .join("");

    await withTempDir("wikigraph-cli-epub-import-", async (path) => {
      const stateDir = resolve(path, "state");
      const archivePath = resolve(path, "little-prince.wikg");
      const archiveUri = formatWikiGraphCommandUri(archivePath);

      await runJsonCLI(stateDir, [
        archiveUri,
        "create",
        "--import",
        LITTLE_PRINCE_EPUB_PATH,
        "--json",
      ]);

      const serials = await readSerials(archivePath);
      expect(serials.length).toBeGreaterThan(0);
      expect(serials.every((serial) => serial.text.length > 0)).toBe(true);
      expect(serials.every((serial) => serial.maps.length > 0)).toBe(true);
      expect(serials.map((serial) => serial.text).join("")).toBe(generatedText);
      const importedMaps = serials.flatMap((serial) => serial.maps);
      expect(importedMaps).toHaveLength(generatedTextRecords.length);
      expect(importedMaps.map((mapping) => mapping.locator)).toStrictEqual(
        generatedTextRecords.map((record) => record.locator),
      );
      expect(
        serials.every((serial) =>
          serial.maps.every(
            (mapping) =>
              mapping.artifact.mediaType === "application/epub+zip" &&
              mapping.artifact.digest === epubDigest &&
              typeof mapping.locator.cfi === "string",
          ),
        ),
      ).toBe(true);

      const chapterList = await runJsonCLI(stateDir, [
        `${archiveUri}/chapter`,
        "--json",
      ]);
      const chapters = chapterList.objects as readonly Record<
        string,
        unknown
      >[];
      expect(chapters.length).toBeGreaterThan(0);
      const chapterUri = formatLocatedChapterResourceUri(
        archivePath,
        requireChapterPath(chapters[0]!),
        "source",
      );
      const locatorPage = await runJsonCLI(stateDir, [
        `${chapterUri}/locators`,
        "--limit",
        "1",
        "--json",
      ]);
      const locatorObjects = locatorPage.objects as readonly unknown[];
      expect(Array.isArray(locatorObjects)).toBe(true);
      expect(locatorObjects).toHaveLength(1);
      const firstLocator = locatorObjects[0] as {
        readonly range: readonly [number, number];
        readonly uri: string;
      };
      expect(firstLocator.range[0]).toBe(1);
      expect(firstLocator.uri).toContain(
        `wikg://artifact/${epubShortUid}#epubcfi(`,
      );
      const sentenceLocatorPage = await runJsonCLI(stateDir, [
        `${chapterUri}/locators#1`,
        "--all",
        "--json",
      ]);
      const sentenceLocators = sentenceLocatorPage.objects as readonly {
        readonly range: readonly [number, number];
        readonly uri: string;
      }[];
      expect(sentenceLocators.length).toBeGreaterThan(0);
      expect(sentenceLocators[0]?.range[0]).toBe(1);
      expect(
        sentenceLocators.every((locator) =>
          locator.uri.includes(`wikg://artifact/${epubShortUid}#epubcfi(`),
        ),
      ).toBe(true);
      const artifactLocator = await runJsonCLI(stateDir, [
        `${archiveUri}/artifact/${epubDigest}#${firstLocator.uri.split("#")[1]}`,
        "--json",
      ]);
      expect(artifactLocator).toMatchObject({
        uri: firstLocator.uri,
        locator: { cfi: generatedTextRecords[0]?.locator.cfi },
      });
    });
  }, 20_000);

  it("sets an EPUB source from JSONL generated by the native importer", async () => {
    const jsonl = await readFile(LITTLE_PRINCE_JSONL_PATH, "utf8");
    const records = parseJsonl(jsonl);
    const artifact = requireArtifact(records);
    const textRecords = records.filter(isTextRecord);
    const expectedText = textRecords.map((record) => record.text).join("");
    const epubDigest = createHash("sha256")
      .update(await readFile(LITTLE_PRINCE_EPUB_PATH))
      .digest("hex");

    await withTempDir("wikigraph-cli-epub-set-", async (path) => {
      const stateDir = resolve(path, "state");
      const archivePath = resolve(path, "little-prince-set.wikg");
      const archiveUri = formatWikiGraphCommandUri(archivePath);

      await runJsonCLI(stateDir, [archiveUri, "create", "--json"]);
      const chapter = await runJsonCLI(stateDir, [
        `${archiveUri}/chapter`,
        "add",
        "--title",
        "The little prince",
        "--json",
      ]);
      const chapterUri = formatLocatedChapterResourceUri(
        archivePath,
        requireChapterPath(chapter),
        "source",
      );

      await runJsonCLI(
        stateDir,
        [
          chapterUri,
          "set",
          "--input",
          "-",
          "--input-format",
          "jsonl",
          "--json",
        ],
        jsonl,
      );

      const serial = await readSingleSerial(archivePath);
      expect(serial.text).toBe(expectedText);
      expect(serial.maps).toHaveLength(textRecords.length);
      expect(serial.maps.at(-1)?.sourceEnd).toBe(
        Array.from(expectedText).length,
      );
      expect(serial.maps.map((mapping) => mapping.locator)).toStrictEqual(
        textRecords.map((record) => record.locator),
      );
      expect(
        serial.maps.every(
          (mapping) =>
            mapping.artifact.mediaType === artifact.mediaType &&
            mapping.artifact.digest === epubDigest &&
            mapping.artifact.name === artifact.name &&
            typeof mapping.locator.cfi === "string",
        ),
      ).toBe(true);
    });
  }, 20_000);
});

async function runJsonCLI(
  stateDir: string,
  argv: readonly string[],
  stdin?: string,
): Promise<Record<string, unknown>> {
  const result = await runWikiGraphCLICaptured({
    argv,
    stateDir,
    ...(stdin === undefined ? {} : { stdin, stdinIsTTY: false }),
  });

  expect(result.exitCode, result.stderr).toBe(0);
  expect(result.stderr).toBe("");
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

async function readSingleSerial(archivePath: string): Promise<SerialSnapshot> {
  const serials = await readSerials(archivePath);
  expect(serials).toHaveLength(1);
  return serials[0]!;
}

async function readSerials(archivePath: string): Promise<SerialSnapshot[]> {
  return await new WikiGraphArchiveFile(new NodeFile(archivePath)).readDocument(
    async (document) => {
      const toc = await document.readToc();
      const serialIds = collectSerialIds(toc?.items ?? []);
      return await Promise.all(
        serialIds.map(async (serialId) => ({
          maps: await document.sourceProvenance.listMap(serialId),
          serialId,
          text: (await document.getSerialFragments(serialId).readText()) ?? "",
        })),
      );
    },
  );
}

function collectSerialIds(items: readonly TocItemLike[]): number[] {
  const serialIds: number[] = [];
  for (const item of items) {
    if (item.serialId !== undefined) serialIds.push(item.serialId);
    serialIds.push(...collectSerialIds(item.children));
  }
  return serialIds;
}

function parseJsonl(input: string): SourceJsonlRecord[] {
  return input
    .split(/\r?\n/u)
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as SourceJsonlRecord);
}

function isTextRecord(record: SourceJsonlRecord): record is SourceTextRecord {
  return record.type === "text";
}

function requireArtifact(
  records: readonly SourceJsonlRecord[],
): SourceArtifactRecord {
  const artifact = records.find((record) => record.type === "artifact");
  if (artifact === undefined || artifact.type !== "artifact") {
    throw new Error("Fixture must contain an artifact record.");
  }
  return artifact;
}

function requireChapterPath(
  chapter: Readonly<Record<string, unknown>>,
): string {
  const uri = chapter.uri;
  if (typeof uri !== "string") {
    throw new Error("CLI chapter output did not contain a URI.");
  }
  return uri.replace(/^wikg:\/\/chapter\//u, "").replace(/\/title$/u, "");
}

function requireString(
  object: Readonly<Record<string, unknown>>,
  key: string,
): string {
  const value = object[key];
  if (typeof value !== "string") {
    throw new Error(`CLI output did not contain string field ${key}.`);
  }
  return value;
}
