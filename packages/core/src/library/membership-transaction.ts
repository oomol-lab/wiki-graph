import {
  copyFileContent,
  ensureRelativeDirectory,
  ensureRelativeFile,
  readFileText,
  writeFileContent,
  type Directory,
  type File,
} from "../runtime/platform/index.js";
import { bytesToHex } from "../utils/bytes.js";
import { randomBytes } from "../utils/crypto.js";

const TRANSACTION_PREFIX = "membership-";
const TRANSACTION_SUFFIX = ".txn";
const RECORD_NAME = "transaction.json";
const PUBLISHED_NAME = "published";
const BACKUP_FILE_NAME = "backup.wikg";
const BACKUP_DIRECTORY_NAME = "backup";
const STAGED_DIRECTORY_NAME = "staged";

type MembershipTransactionRecord =
  | { readonly kind: "add"; readonly targetPath: string }
  | {
      readonly kind: "migrate";
      readonly targetPath: string;
    }
  | {
      readonly kind: "move";
      readonly sourcePath: string;
      readonly targetPath: string;
    }
  | {
      readonly kind: "remove";
      readonly sourceKind: "directory" | "file";
      readonly sourcePath: string;
    };

export class LibraryMembershipTransaction {
  readonly #libraryRoot: Directory;
  readonly #record: MembershipTransactionRecord;
  readonly #stagingRoot: Directory;
  public readonly directory: Directory;

  public constructor(input: {
    readonly directory: Directory;
    readonly libraryRoot: Directory;
    readonly record: MembershipTransactionRecord;
    readonly stagingRoot: Directory;
  }) {
    this.directory = input.directory;
    this.#libraryRoot = input.libraryRoot;
    this.#record = input.record;
    this.#stagingRoot = input.stagingRoot;
  }

  public async createBackupFile(): Promise<File> {
    return await this.directory.createFile(BACKUP_FILE_NAME);
  }

  public async createBackupDirectory(): Promise<Directory> {
    return await this.directory.createDirectory(BACKUP_DIRECTORY_NAME);
  }

  public async createStagedDirectory(): Promise<Directory> {
    return await this.directory.createDirectory(STAGED_DIRECTORY_NAME);
  }

  public async markPublished(): Promise<void> {
    await writeFileContent(
      await this.directory.createFile(PUBLISHED_NAME),
      "1",
    );
  }

  public async finish(): Promise<void> {
    await this.#stagingRoot.remove(this.directory.name, { recursive: true });
  }

  public async recover(): Promise<void> {
    await recoverMembershipTransaction(
      this.#libraryRoot,
      this.#stagingRoot,
      this.directory,
      this.#record,
    );
  }
}

export async function beginLibraryMembershipTransaction(
  libraryRoot: Directory,
  stagingRoot: Directory,
  record: MembershipTransactionRecord,
): Promise<LibraryMembershipTransaction> {
  validateRecord(record);
  const directory = await stagingRoot.createDirectory(
    `${TRANSACTION_PREFIX}${bytesToHex(randomBytes(12))}${TRANSACTION_SUFFIX}`,
  );
  try {
    await writeFileContent(
      await directory.createFile(RECORD_NAME),
      JSON.stringify(record),
    );
  } catch (error) {
    await stagingRoot
      .remove(directory.name, { recursive: true })
      .catch(() => undefined);
    throw error;
  }
  return new LibraryMembershipTransaction({
    directory,
    libraryRoot,
    record,
    stagingRoot,
  });
}

export async function recoverLibraryMembershipTransactions(
  libraryRoot: Directory,
  stagingRoot: Directory,
): Promise<void> {
  for (const entry of await stagingRoot.list()) {
    if (
      entry.kind !== "directory" ||
      !entry.name.startsWith(TRANSACTION_PREFIX) ||
      !entry.name.endsWith(TRANSACTION_SUFFIX)
    ) {
      continue;
    }
    const recordFile = await entry.getFile(RECORD_NAME);
    if (recordFile === undefined) {
      await stagingRoot.remove(entry.name, { recursive: true });
      continue;
    }
    const record = parseRecord(await readFileText(recordFile));
    await recoverMembershipTransaction(libraryRoot, stagingRoot, entry, record);
  }
}

export async function copyDirectoryContent(
  source: Directory,
  target: Directory,
): Promise<void> {
  for (const entry of await source.list()) {
    if (entry.kind === "directory") {
      const child =
        (await target.getDirectory(entry.name)) ??
        (await target.createDirectory(entry.name));
      await copyDirectoryContent(entry, child);
      continue;
    }
    const destination =
      (await target.getFile(entry.name)) ??
      (await target.createFile(entry.name));
    await copyFileContent(entry, destination);
  }
}

async function recoverMembershipTransaction(
  libraryRoot: Directory,
  stagingRoot: Directory,
  transaction: Directory,
  record: MembershipTransactionRecord,
): Promise<void> {
  const published = (await transaction.getFile(PUBLISHED_NAME)) !== undefined;
  if (published) {
    if (record.kind === "move") {
      await removeRelativeEntry(libraryRoot, record.sourcePath);
    } else if (record.kind === "remove") {
      await removeRelativeEntry(libraryRoot, record.sourcePath);
    }
  } else if (record.kind === "add") {
    await removeRelativeEntry(libraryRoot, record.targetPath);
  } else if (record.kind === "move") {
    await removeRelativeEntry(libraryRoot, record.targetPath);
  } else if (record.kind === "remove") {
    await restoreRemovedEntry(libraryRoot, transaction, record);
  } else {
    await restoreMigratedFile(libraryRoot, transaction, record.targetPath);
  }
  await stagingRoot.remove(transaction.name, { recursive: true });
}

async function restoreRemovedEntry(
  libraryRoot: Directory,
  transaction: Directory,
  record: Extract<MembershipTransactionRecord, { readonly kind: "remove" }>,
): Promise<void> {
  await removeRelativeEntry(libraryRoot, record.sourcePath);
  if (record.sourceKind === "file") {
    const backup = await transaction.getFile(BACKUP_FILE_NAME);
    if (backup === undefined)
      throw new Error("Missing membership file backup.");
    await copyFileContent(
      backup,
      await ensureRelativeFile(libraryRoot, record.sourcePath),
    );
    return;
  }
  const backup = await transaction.getDirectory(BACKUP_DIRECTORY_NAME);
  if (backup === undefined) {
    throw new Error("Missing membership directory backup.");
  }
  await copyDirectoryContent(
    backup,
    await ensureRelativeDirectory(libraryRoot, record.sourcePath),
  );
}

async function restoreMigratedFile(
  libraryRoot: Directory,
  transaction: Directory,
  targetPath: string,
): Promise<void> {
  const backup = await transaction.getFile(BACKUP_FILE_NAME);
  if (backup === undefined) throw new Error("Missing migration file backup.");
  await removeRelativeEntry(libraryRoot, targetPath);
  await copyFileContent(
    backup,
    await ensureRelativeFile(libraryRoot, targetPath),
  );
}

async function removeRelativeEntry(
  root: Directory,
  relativePath: string,
): Promise<void> {
  const { name, parent } = await resolveRelativeParent(root, relativePath);
  if (parent === undefined) return;
  if ((await parent.getFile(name)) !== undefined) {
    await parent.remove(name);
  } else if ((await parent.getDirectory(name)) !== undefined) {
    await parent.remove(name, { recursive: true });
  }
}

async function resolveRelativeParent(
  root: Directory,
  relativePath: string,
): Promise<{ readonly name: string; readonly parent?: Directory }> {
  const parts = validateRelativePath(relativePath).split("/");
  const name = parts.pop()!;
  let parent = root;
  for (const part of parts) {
    const child = await parent.getDirectory(part);
    if (child === undefined) return { name };
    parent = child;
  }
  return { name, parent };
}

function parseRecord(value: string): MembershipTransactionRecord {
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== "object" || parsed === null || !("kind" in parsed)) {
    throw new Error("Invalid library membership transaction.");
  }
  const record = parsed as MembershipTransactionRecord;
  validateRecord(record);
  return record;
}

function validateRecord(record: MembershipTransactionRecord): void {
  if (record.kind === "add" || record.kind === "migrate") {
    validateRelativePath(record.targetPath);
    return;
  }
  if (record.kind === "move") {
    validateRelativePath(record.sourcePath);
    validateRelativePath(record.targetPath);
    return;
  }
  if (record.kind === "remove") {
    validateRelativePath(record.sourcePath);
    if (record.sourceKind !== "directory" && record.sourceKind !== "file") {
      throw new Error("Invalid library membership transaction source kind.");
    }
    return;
  }
  throw new Error("Invalid library membership transaction kind.");
}

function validateRelativePath(relativePath: string): string {
  const normalized = relativePath.replaceAll("\\", "/");
  if (
    normalized === "" ||
    normalized.startsWith("/") ||
    normalized.endsWith("/") ||
    normalized
      .split("/")
      .some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error("Invalid library membership transaction path.");
  }
  return normalized;
}
