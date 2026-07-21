export type WikgArchiveOverlay =
  | {
      readonly entryPath: string;
      readonly kind: "deleted";
    }
  | {
      readonly entryPath: string;
      readonly kind: "file";
      readonly workspacePath: string;
    };
