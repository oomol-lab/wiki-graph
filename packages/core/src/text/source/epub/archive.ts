import {
  getWikiGraphPlatform,
  type File,
  type HostZipReader,
} from "../../../runtime/platform/index.js";
import { createPortableHash as createHash } from "../../../utils/crypto.js";

/** EPUB reader backed only by the host ZIP and File capabilities. */
export class EpubArchive {
  readonly #file: File;
  readonly #entries: ReadonlyMap<string, string>;
  readonly #reader: HostZipReader;
  readonly #digest: string;

  // eslint-disable-next-line no-restricted-syntax -- constructors cannot use JavaScript #private syntax.
  private constructor(
    file: File,
    reader: HostZipReader,
    entries: ReadonlyMap<string, string>,
    digest: string,
  ) {
    this.#file = file;
    this.#reader = reader;
    this.#entries = entries;
    this.#digest = digest;
  }

  public static async open(file: File): Promise<EpubArchive> {
    const rangeReader = await file.openReader();
    const hash = createHash("sha256");
    try {
      for (let offset = 0; offset < rangeReader.size; ) {
        const chunk = await rangeReader.read(
          offset,
          Math.min(64 * 1024, rangeReader.size - offset),
        );
        hash.update(chunk);
        offset += chunk.byteLength;
      }
    } finally {
      await rangeReader.close();
    }
    const digest = hash.digest("hex");
    const reader = await getWikiGraphPlatform().zip.open(file);
    try {
      const entries = new Map<string, string>();
      for (const hostName of await reader.listEntries()) {
        const name = normalizeArchivePath(hostName);
        if (name !== "") entries.set(name, hostName);
      }
      return new EpubArchive(file, reader, entries, digest);
    } catch (error) {
      await reader.close();
      throw error;
    }
  }

  public close(): Promise<void> {
    return this.#reader.close();
  }

  public hasEntry(path: string): boolean {
    return this.#entries.has(normalizeArchivePath(path));
  }

  public listEntries(): readonly string[] {
    return [...this.#entries.keys()];
  }

  public async readText(path: string): Promise<string> {
    return new TextDecoder().decode(await this.readBuffer(path));
  }

  public async readBuffer(path: string): Promise<Uint8Array> {
    const hostName = this.#getEntry(path);
    const data = await this.#reader.readEntry(hostName);
    if (data === undefined) {
      throw new Error(
        `EPUB entry does not exist: ${normalizeArchivePath(path)}`,
      );
    }
    return data;
  }

  public resolveRelativePath(basePath: string, href: string): string {
    const normalizedHref = normalizeHref(href);
    if (normalizedHref === "") {
      throw new Error(`Invalid EPUB href: ${href}`);
    }
    return normalizeArchivePath(
      joinArchivePath(
        dirnameArchivePath(normalizeArchivePath(basePath)),
        normalizedHref,
      ),
    );
  }

  public createSectionId(path: string, fragment?: string): string {
    const normalizedPath = normalizeArchivePath(path);
    return fragment === undefined || fragment === ""
      ? normalizedPath
      : `${normalizedPath}#${fragment}`;
  }

  public createSyntheticSectionId(path: string, title?: string): string {
    const normalizedPath = normalizeArchivePath(path);
    const hash = createHash("sha1")
      .update(`${normalizedPath}:${title ?? ""}`)
      .digest("hex")
      .slice(0, 10);
    return `toc:${hash}`;
  }

  public get name(): string {
    return this.#file.name;
  }

  public get digest(): string {
    return this.#digest;
  }

  #getEntry(path: string): string {
    const normalizedPath = normalizeArchivePath(path);
    const entry = this.#entries.get(normalizedPath);
    if (entry === undefined) {
      throw new Error(`EPUB entry does not exist: ${normalizedPath}`);
    }
    return entry;
  }
}

export function normalizeArchivePath(path: string): string {
  const output: string[] = [];
  for (const part of path.replaceAll("\\", "/").trim().split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") output.pop();
    else output.push(part);
  }
  return output.join("/");
}

export function normalizeHref(href: string): string {
  const [path] = href.split("#", 1);
  return normalizeArchivePath(path ?? "");
}

export function normalizeFragment(
  fragment: string | undefined,
): string | undefined {
  if (fragment === undefined) return undefined;
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

function dirnameArchivePath(path: string): string {
  return path.split("/").slice(0, -1).join("/");
}

function joinArchivePath(...parts: readonly string[]): string {
  return parts.filter(Boolean).join("/");
}
