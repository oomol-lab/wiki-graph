import { createHash } from "crypto";
import { posix } from "path";
import { PassThrough, type Readable } from "stream";
import type { Entry, ZipFile } from "yauzl";
import { open } from "yauzl";

export class EpubArchive {
  readonly #path: string;
  readonly #zipFile: ZipFile;
  readonly #entries: ReadonlyMap<string, Entry>;
  #closed = false;

  public constructor(
    path: string,
    zipFile: ZipFile,
    entries: ReadonlyMap<string, Entry>,
  ) {
    this.#path = path;
    this.#zipFile = zipFile;
    this.#entries = entries;
  }

  public static async open(path: string): Promise<EpubArchive> {
    const zipFile = await openZipFile(path);
    const entries = await indexEntries(zipFile);

    return new EpubArchive(path, zipFile, entries);
  }

  public close(): Promise<void> {
    if (this.#closed) {
      return Promise.resolve();
    }

    this.#closed = true;
    this.#zipFile.close();

    return Promise.resolve();
  }

  public hasEntry(path: string): boolean {
    return this.#entries.has(normalizeArchivePath(path));
  }

  public listEntries(): readonly string[] {
    return [...this.#entries.keys()];
  }

  public async openReadStream(path: string): Promise<Readable> {
    const entry = this.#getEntry(path);

    return await openEntryStream(this.#zipFile, entry);
  }

  public async readText(path: string): Promise<string> {
    const stream = await this.openReadStream(path);
    return (await readStreamToBuffer(stream)).toString("utf8");
  }

  public async readBuffer(path: string): Promise<Buffer> {
    const stream = await this.openReadStream(path);
    return await readStreamToBuffer(stream);
  }

  public resolveRelativePath(basePath: string, href: string): string {
    const normalizedHref = normalizeHref(href);
    if (normalizedHref === "") {
      throw new Error(`Invalid EPUB href: ${href}`);
    }

    return normalizeArchivePath(
      posix.join(posix.dirname(normalizeArchivePath(basePath)), normalizedHref),
    );
  }

  public createSectionId(path: string, fragment?: string): string {
    const normalizedPath = normalizeArchivePath(path);

    if (fragment === undefined || fragment === "") {
      return normalizedPath;
    }

    return `${normalizedPath}#${fragment}`;
  }

  public createSyntheticSectionId(path: string, title?: string): string {
    const normalizedPath = normalizeArchivePath(path);
    const hash = createHash("sha1")
      .update(`${normalizedPath}:${title ?? ""}`)
      .digest("hex")
      .slice(0, 10);

    return `toc:${hash}`;
  }

  public get path(): string {
    return this.#path;
  }

  #getEntry(path: string): Entry {
    const normalizedPath = normalizeArchivePath(path);
    const entry = this.#entries.get(normalizedPath);

    if (entry === undefined) {
      throw new Error(`EPUB entry does not exist: ${normalizedPath}`);
    }

    return entry;
  }
}

export function normalizeArchivePath(path: string): string {
  const normalized = path.replaceAll("\\", "/").trim();
  const withoutFragment = normalized.startsWith("/")
    ? normalized.slice(1)
    : normalized;

  return posix
    .normalize(withoutFragment)
    .replace(/^(\.\/)+/, "")
    .replace(/^\/+/, "");
}

export function normalizeHref(href: string): string {
  const [path] = href.split("#", 1);

  return normalizeArchivePath(path ?? "");
}

export function normalizeFragment(
  fragment: string | undefined,
): string | undefined {
  if (fragment === undefined) {
    return undefined;
  }

  const normalized = fragment.startsWith("#") ? fragment.slice(1) : fragment;

  return normalized === "" ? undefined : normalized;
}

export function splitHref(href: string): {
  readonly path: string;
  readonly fragment: string | undefined;
} {
  const [pathPart, fragmentPart] = href.split("#", 2);

  return {
    path: normalizeArchivePath(pathPart ?? ""),
    fragment: normalizeFragment(fragmentPart),
  };
}

async function openZipFile(path: string): Promise<ZipFile> {
  return await new Promise((resolve, reject) => {
    open(path, { autoClose: false, lazyEntries: true }, (error, zipFile) => {
      if (error !== null || zipFile === undefined) {
        reject(error ?? new Error(`Cannot open EPUB archive: ${path}`));
        return;
      }

      resolve(zipFile);
    });
  });
}

async function indexEntries(
  zipFile: ZipFile,
): Promise<ReadonlyMap<string, Entry>> {
  return await new Promise((resolve, reject) => {
    const entries = new Map<string, Entry>();

    zipFile.on("entry", (entry: Entry) => {
      if (entry.fileName.endsWith("/")) {
        zipFile.readEntry();
        return;
      }

      entries.set(normalizeArchivePath(entry.fileName), entry);
      zipFile.readEntry();
    });
    zipFile.once("end", () => {
      resolve(entries);
    });
    zipFile.once("error", (error: Error) => {
      reject(error);
    });

    zipFile.readEntry();
  });
}

function toBuffer(chunk: unknown): Buffer {
  if (Buffer.isBuffer(chunk)) {
    return chunk;
  }

  if (typeof chunk === "string") {
    return Buffer.from(chunk, "utf8");
  }

  throw new Error("Unexpected ZIP stream chunk type");
}

async function readStreamToBuffer(stream: Readable): Promise<Buffer> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    stream.on("data", (chunk: unknown) => {
      chunks.push(toBuffer(chunk));
    });
    stream.once("end", () => {
      resolve(Buffer.concat(chunks));
    });
    stream.once("error", (error: Error) => {
      reject(error);
    });
    stream.resume();
  });
}

async function openEntryStream(
  zipFile: ZipFile,
  entry: Entry,
): Promise<Readable> {
  return await new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (error, stream) => {
      if (error !== null || stream === undefined) {
        reject(error ?? new Error(`Cannot open EPUB entry: ${entry.fileName}`));
        return;
      }

      resolve(normalizeEntryStream(stream));
    });
  });
}

function normalizeEntryStream(stream: Readable): Readable {
  const normalized = new PassThrough();

  stream.once("error", (error: Error) => {
    normalized.destroy(error);
  });
  normalized.once("close", () => {
    stream.unpipe(normalized);

    if (!stream.destroyed) {
      stream.destroy();
    }
  });

  stream.pipe(normalized);

  return normalized;
}
