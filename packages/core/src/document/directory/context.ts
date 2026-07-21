import type { DirectoryDocument } from "./core.js";
import type { DocumentContext } from "./types.js";

export class DirectoryDocumentContext implements DocumentContext {
  readonly #createdFilePaths: string[] = [];
  readonly #document: DirectoryDocument;
  readonly #ownedSerialIds = new Set<number>();
  #completed = false;
  #disposed = false;

  public constructor(document: DirectoryDocument) {
    this.#document = document;
  }

  public complete(): void {
    this.#assertActive();
    this.#completed = true;
  }

  public async dispose(): Promise<void> {
    if (this.#disposed) {
      return;
    }

    this.#disposed = true;

    if (this.#completed) {
      return;
    }

    await this.#document.rollbackContext(this);
  }

  public ownSerial(serialId: number): void {
    this.#assertActive();
    this.#ownedSerialIds.add(serialId);
  }

  public async run<T>(operation: () => Promise<T> | T): Promise<T> {
    this.#assertActive();
    return await this.#document.runWithContext(this, operation);
  }

  public listCreatedFilePaths(): readonly string[] {
    return [...this.#createdFilePaths];
  }

  public listOwnedSerialIds(): readonly number[] {
    return [...this.#ownedSerialIds];
  }

  public registerCreatedFile(path: string): void {
    this.#createdFilePaths.push(path);
  }

  #assertActive(): void {
    if (this.#disposed) {
      throw new Error("DocumentContext is already disposed");
    }
  }
}

export function compareNumberDescending(left: number, right: number): number {
  return right - left;
}
