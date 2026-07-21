import type { ArchiveCollectionResult } from "wiki-graph-core";

import type { CLIArchiveArguments } from "../../../args.js";

export type ResultFormat = "json" | "jsonl" | "text";

export const DEFAULT_OUTPUT_LIMIT = 20;
export const DEFAULT_GET_EVIDENCE_LIMIT = 3;
export const ALL_COLLECTION_OUTPUT_LIMIT = 1_000_000_000;

export interface ArchiveOutputContext {
  readonly archiveKey: string;
  readonly archivePath: string;
  readonly backlinks?: boolean;
  readonly chapters?: readonly number[];
  readonly continuationKind?: "collection" | "evidence" | "related" | "search";
  readonly evidenceDisabled?: boolean;
  readonly evidenceLimit?: number;
  readonly format: ResultFormat;
  readonly ids?: readonly string[];
  readonly limit: number;
  readonly order?: ArchiveCollectionResult["order"];
  readonly query?: string;
  readonly role?: CLIArchiveArguments["role"];
  readonly sourceContext?: number;
  readonly targetUri?: string;
  readonly triplePattern?: CLIArchiveArguments["triplePattern"];
  readonly types: readonly string[] | null;
}
