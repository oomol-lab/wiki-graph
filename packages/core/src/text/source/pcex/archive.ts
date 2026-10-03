import {
  getWikiGraphPlatform,
  type File,
  type HostZipReader,
} from "../../../runtime/platform/index.js";

export class PcexArchive {
  readonly #reader: HostZipReader;
  readonly #entries: ReadonlyMap<string, string>;

  // eslint-disable-next-line no-restricted-syntax -- constructors cannot use JavaScript #private syntax.
  private constructor(
    reader: HostZipReader,
    entries: ReadonlyMap<string, string>,
  ) {
    this.#reader = reader;
    this.#entries = entries;
  }

  public static async open(file: File): Promise<PcexArchive> {
    const reader = await getWikiGraphPlatform().zip.open(file);
    try {
      const entries = new Map<string, string>();
      for (const hostName of await reader.listEntries()) {
        const name = normalizePath(hostName);
        if (name !== "") entries.set(name, hostName);
      }
      return new PcexArchive(reader, entries);
    } catch (error) {
      await reader.close();
      throw error;
    }
  }

  public close(): Promise<void> {
    return this.#reader.close();
  }

  public hasEntry(path: string): boolean {
    return this.#entries.has(normalizePath(path));
  }

  public listEntries(): readonly string[] {
    return [...this.#entries.keys()];
  }

  public async readText(path: string): Promise<string> {
    const name = normalizePath(path);
    const hostName = this.#entries.get(name);
    if (hostName === undefined)
      throw new Error(`PCEX entry does not exist: ${name}`);
    const data = await this.#reader.readEntry(hostName);
    if (data === undefined)
      throw new Error(`PCEX entry does not exist: ${name}`);
    return new TextDecoder().decode(data);
  }
}

function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.replaceAll("\\", "/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") throw new Error("PCEX contains an unsafe archive path.");
    parts.push(part);
  }
  return parts.join("/");
}
