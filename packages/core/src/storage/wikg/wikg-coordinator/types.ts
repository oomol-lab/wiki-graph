export type EntryLockMode = "read" | "state" | "write";
export type SqliteLeaseMode = "read" | "write";
export type WorkspaceWritebackPolicy = "archive" | "cache";

export interface EntryOverlay {
  readonly archiveKey: string;
  readonly archivePath: string;
  readonly archiveSignature?: string;
  readonly entryPath: string;
  readonly kind: "deleted" | "file";
  readonly mutationToken?: string;
  readonly updatedAt: number;
  readonly workspacePath?: string;
}

export interface EntryLock {
  readonly entryPath: string;
  readonly mode: EntryLockMode;
  readonly ownerId: string;
}

export interface ArchiveCommitLock {
  readonly ownerId: string;
}

export interface WorkspaceDirectoryEntry {
  isDirectory(): boolean;
  isFile(): boolean;
  readonly name: string;
}
