import { SpineDigestApp } from "../index.js";
import { SpineDigestFile } from "../facade/spine-digest-file.js";
import type { BookMeta } from "../source/index.js";

import type {
  ArchiveMetaPatch,
  CLIArchiveCoverArguments,
  CLIArchiveMetadataArguments,
} from "./args.js";
import { writeBinaryToStdout, writeTextToStdout } from "./io.js";
import { formatCLIJSON } from "./json.js";

export async function runArchiveMetaCommand(
  args: CLIArchiveMetadataArguments,
): Promise<void> {
  if (args.metaPatch !== undefined) {
    await updateArchiveMeta(args.inputPath, args.metaPatch);
    return;
  }

  const app = new SpineDigestApp({});
  await app.openSession(args.inputPath, async (digest) => {
    await writeArchiveMeta(await digest.readMeta(), {
      json: args.json ?? false,
    });
  });
}

export async function runArchiveCoverCommand(
  args: CLIArchiveCoverArguments,
): Promise<void> {
  const app = new SpineDigestApp({});
  await app.openSession(args.inputPath, async (digest) => {
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
  });
}

async function updateArchiveMeta(
  path: string,
  patch: ArchiveMetaPatch,
): Promise<void> {
  await new SpineDigestFile(path).write(async (document) => {
    const meta = await document.readBookMeta();

    if (meta === undefined) {
      throw new Error("Document book meta is missing.");
    }

    const updatedMeta = applyArchiveMetaPatch(meta, patch);

    await document.replaceBookMeta(updatedMeta);
    await writeArchiveMeta(updatedMeta, { json: false });
  });
}

async function writeArchiveMeta(
  meta: BookMeta | undefined,
  options: { readonly json: boolean },
): Promise<void> {
  if (options.json) {
    await writeTextToStdout(formatCLIJSON(formatMetaJSON(meta)));
    return;
  }

  if (meta === undefined) {
    await writeTextToStdout("No document metadata is available.\n");
    return;
  }

  const lines: string[] = [];

  appendMetaLines(lines, meta);

  await writeTextToStdout(`${lines.join("\n")}\n`);
}

function applyArchiveMetaPatch(
  meta: BookMeta,
  patch: ArchiveMetaPatch,
): BookMeta {
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

function appendMetaLines(lines: string[], meta: BookMeta | undefined): void {
  lines.push(`Source Format: ${meta?.sourceFormat ?? "[none]"}`);
  lines.push(`Title: ${meta?.title ?? "[none]"}`);
  lines.push(
    `Authors: ${
      meta?.authors.length === undefined || meta.authors.length === 0
        ? "[none]"
        : meta.authors.join(", ")
    }`,
  );
  lines.push(`Language: ${meta?.language ?? "[none]"}`);
  lines.push(`Identifier: ${meta?.identifier ?? "[none]"}`);
  lines.push(`Publisher: ${meta?.publisher ?? "[none]"}`);
  lines.push(`Published At: ${meta?.publishedAt ?? "[none]"}`);
  lines.push(`Description: ${meta?.description ?? "[none]"}`);
}

function formatMetaJSON(meta: BookMeta | undefined): object {
  return {
    authors: meta?.authors ?? [],
    description: meta?.description ?? null,
    identifier: meta?.identifier ?? null,
    language: meta?.language ?? null,
    publishedAt: meta?.publishedAt ?? null,
    publisher: meta?.publisher ?? null,
    sourceFormat: meta?.sourceFormat ?? null,
    title: meta?.title ?? null,
  };
}
