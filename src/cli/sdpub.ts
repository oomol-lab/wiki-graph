import { SpineDigestApp } from "../index.js";
import { SpineDigestFile } from "../facade/spine-digest-file.js";
import type { SpineDigest } from "../facade/index.js";
import type { BookMeta, TocFile, TocItem } from "../source/index.js";

import type { CLISdpubArguments, SdpubMetaPatch } from "./args.js";
import { writeBinaryToStdout, writeTextToStdout } from "./io.js";

export async function runSdpubCommand(args: CLISdpubArguments): Promise<void> {
  if (args.subcommand === "meta" && args.metaPatch !== undefined) {
    await updateSdpubMeta(args.inputPath, args.metaPatch);
    return;
  }

  const app = new SpineDigestApp({});
  await app.openSession(args.inputPath, async (digest) => {
    switch (args.subcommand) {
      case "info":
        await writeSdpubInfo(digest);
        return;
      case "toc":
        await writeSdpubToc(digest);
        return;
      case "list":
        await writeSdpubSerialList(digest);
        return;
      case "cat":
        await writeTextToStdout(await digest.readSerialSummary(args.serialId!));
        return;
      case "cover":
        await writeSdpubCover(digest);
        return;
      case "meta":
        await writeSdpubMeta(await digest.readMeta());
        return;
    }
  });
}

async function writeSdpubInfo(digest: SpineDigest): Promise<void> {
  const [formatVersion, meta, cover, toc, serials] = await Promise.all([
    digest.readArchiveFormatVersion(),
    digest.readMeta(),
    digest.readCover(),
    digest.readToc(),
    digest.listSerials().catch((error: unknown) => {
      if (
        error instanceof Error &&
        error.message === "Document TOC is missing"
      ) {
        return [];
      }

      throw error;
    }),
  ]);
  const lines: string[] = [];

  lines.push(`Archive Format Version: ${formatVersion}`);
  appendOptionalLine(lines, "Title", meta?.title);
  if (meta?.authors.length !== undefined && meta.authors.length > 0) {
    lines.push(`Authors: ${meta.authors.join(", ")}`);
  }
  appendOptionalLine(lines, "Language", meta?.language);
  appendOptionalLine(lines, "Source Format", meta?.sourceFormat);
  appendOptionalLine(lines, "Identifier", meta?.identifier);
  appendOptionalLine(lines, "Publisher", meta?.publisher);
  appendOptionalLine(lines, "Published At", meta?.publishedAt);
  appendOptionalLine(lines, "Description", meta?.description);
  lines.push(`Cover: ${cover === undefined ? "no" : "yes"}`);
  appendOptionalLine(lines, "Cover Media Type", cover?.mediaType);
  appendOptionalLine(lines, "Cover Path", cover?.path);

  if (toc !== undefined) {
    if (lines.length > 0) {
      lines.push("");
    }

    lines.push(`Top-level Sections: ${toc.items.length}`);
    lines.push(`Referenced Serials: ${serials.length}`);
    lines.push(
      `Fragments: ${serials.reduce(
        (total, serial) => total + serial.fragmentCount,
        0,
      )}`,
    );
  }

  if (lines.length === 0) {
    lines.push("No document metadata is available.");
  }

  await writeTextToStdout(`${lines.join("\n")}\n`);
}

async function writeSdpubToc(digest: SpineDigest): Promise<void> {
  const [meta, toc] = await Promise.all([
    digest.readMeta(),
    requireToc(digest),
  ]);
  const lines: string[] = [];
  const title = normalizeDisplayValue(meta?.title);

  if (title !== undefined) {
    lines.push(title, "");
  }

  const tocLines = renderTocLines(toc.items);

  if (tocLines.length === 0) {
    lines.push("No TOC items.");
  } else {
    lines.push(...tocLines);
  }

  await writeTextToStdout(`${lines.join("\n")}\n`);
}

async function writeSdpubSerialList(digest: SpineDigest): Promise<void> {
  const serials = await digest.listSerials();

  if (serials.length === 0) {
    await writeTextToStdout("No serials referenced by TOC.\n");
    return;
  }

  await writeTextToStdout(
    `${serials
      .map(
        (serial) =>
          `[${serial.serialId}] ${serial.tocPath.join(" / ")} (fragments: ${serial.fragmentCount})`,
      )
      .join("\n")}\n`,
  );
}

async function writeSdpubCover(digest: SpineDigest): Promise<void> {
  if (process.stdout.isTTY === true) {
    throw new Error(
      "Refusing to write binary cover data to an interactive terminal. Redirect stdout or pipe it.",
    );
  }

  const cover = await digest.readCover();

  if (cover === undefined) {
    throw new Error("Document cover is missing.");
  }

  await writeBinaryToStdout(cover.data);
}

async function updateSdpubMeta(
  path: string,
  patch: SdpubMetaPatch,
): Promise<void> {
  await new SpineDigestFile(path).openEditableSession(async (document) => {
    const meta = await document.readBookMeta();

    if (meta === undefined) {
      throw new Error("Document book meta is missing.");
    }

    const updatedMeta = applySdpubMetaPatch(meta, patch);

    await document.replaceBookMeta(updatedMeta);
    await writeSdpubMeta(updatedMeta);
  });
}

async function writeSdpubMeta(meta: BookMeta | undefined): Promise<void> {
  if (meta === undefined) {
    await writeTextToStdout("No document metadata is available.\n");
    return;
  }

  const lines = [
    `Source Format: ${meta.sourceFormat}`,
    `Title: ${meta.title ?? "[none]"}`,
    `Authors: ${
      meta.authors.length === 0 ? "[none]" : meta.authors.join(", ")
    }`,
    `Language: ${meta.language ?? "[none]"}`,
    `Identifier: ${meta.identifier ?? "[none]"}`,
    `Publisher: ${meta.publisher ?? "[none]"}`,
    `Published At: ${meta.publishedAt ?? "[none]"}`,
    `Description: ${meta.description ?? "[none]"}`,
  ];

  await writeTextToStdout(`${lines.join("\n")}\n`);
}

function applySdpubMetaPatch(meta: BookMeta, patch: SdpubMetaPatch): BookMeta {
  return {
    ...meta,
    title: patch.clearTitle === true ? null : (patch.title ?? meta.title),
    authors:
      patch.clearAuthors === true
        ? []
        : patch.authors === undefined
          ? meta.authors
          : [...patch.authors],
    language:
      patch.clearLanguage === true ? null : (patch.language ?? meta.language),
    identifier:
      patch.clearIdentifier === true
        ? null
        : (patch.identifier ?? meta.identifier),
    publisher:
      patch.clearPublisher === true
        ? null
        : (patch.publisher ?? meta.publisher),
    publishedAt:
      patch.clearPublishedAt === true
        ? null
        : (patch.publishedAt ?? meta.publishedAt),
    description:
      patch.clearDescription === true
        ? null
        : (patch.description ?? meta.description),
  };
}

function appendOptionalLine(
  lines: string[],
  label: string,
  value: string | null | undefined,
): void {
  const normalized = normalizeDisplayValue(value);

  if (normalized !== undefined) {
    lines.push(`${label}: ${normalized}`);
  }
}

function normalizeDisplayValue(
  value: string | null | undefined,
): string | undefined {
  const normalized = value?.trim();

  return normalized === undefined || normalized === "" ? undefined : normalized;
}

async function requireToc(digest: SpineDigest): Promise<TocFile> {
  const toc = await digest.readToc();

  if (toc === undefined) {
    throw new Error("Document TOC is missing");
  }

  return toc;
}

function renderTocLines(
  items: readonly TocItem[],
  depth = 0,
): readonly string[] {
  const lines: string[] = [];

  for (const item of items) {
    lines.push(
      `${"  ".repeat(depth)}${item.title?.trim() || "[untitled]"}${
        item.serialId === undefined ? "" : ` [serial ${item.serialId}]`
      }`,
    );
    lines.push(...renderTocLines(item.children, depth + 1));
  }

  return lines;
}
