import type { CLIFormat } from "../support/index.js";
import type { LocalConfigSection } from "../runtime/local-config.js";
import type {
  ArchiveTriplePattern,
  BuildJobTarget,
  ChapterStage,
  ParsedWikiGraphLibraryUri,
} from "wiki-graph-core";

export interface CLIArguments {
  readonly digestDirPath?: string;
  readonly help: boolean;
  readonly inputPath?: string;
  readonly inputFormat?: CLIFormat;
  readonly llmJSON?: string;
  readonly outputPath?: string;
  readonly outputFormat?: CLIFormat;
  readonly prompt?: string;
  readonly targetStage?: ChapterStage;
  readonly verbose: boolean;
}

export interface CLIArchiveMetadataArguments {
  readonly inputPath: string;
  readonly json?: boolean;
  readonly llmJSON?: string;
  readonly metaPatch?: ArchiveMetaPatch;
}

export interface CLIArchiveCoverArguments {
  readonly inputPath: string;
  readonly llmJSON?: string;
}

export interface ArchiveMetaPatch {
  readonly authors?: readonly string[];
  readonly clearAuthors?: boolean;
  readonly clearDescription?: boolean;
  readonly clearIdentifier?: boolean;
  readonly clearLanguage?: boolean;
  readonly clearPublishedAt?: boolean;
  readonly clearPublisher?: boolean;
  readonly clearTitle?: boolean;
  readonly description?: string;
  readonly identifier?: string;
  readonly language?: string;
  readonly publishedAt?: string;
  readonly publisher?: string;
  readonly title?: string;
}

export type CLIArchiveChapterAction =
  | "add"
  | "list"
  | "move"
  | "remove"
  | "reset"
  | "set"
  | "set-source"
  | "set-summary"
  | "set-title"
  | "tree";

export interface CLIArchiveChapterArguments {
  readonly action: CLIArchiveChapterAction;
  readonly afterChapterPath?: string;
  readonly afterChapterId?: number;
  readonly beforeChapterPath?: string;
  readonly beforeChapterId?: number;
  readonly chapterPath?: string;
  readonly chapterId?: number;
  readonly clearTitle?: boolean;
  readonly dryRun?: boolean;
  readonly first?: boolean;
  readonly inputPath?: string;
  readonly inputValue?: string;
  readonly json?: boolean;
  readonly last?: boolean;
  readonly llmJSON?: string;
  readonly moveToRoot?: boolean;
  readonly parentChapterPath?: string;
  readonly parentChapterId?: number;
  readonly path: string;
  readonly prompt?: string;
  readonly recursive?: boolean;
  readonly resetStage?: Exclude<ChapterStage, "summarized">;
  readonly title?: string;
  readonly treeAction?: "apply" | "show";
}

export type CLIMetadataAction = "clear" | "delete" | "get" | "put" | "set";

export interface CLIObjectMetadataArguments {
  readonly action: CLIMetadataAction;
  readonly archivePath: string;
  readonly inputPath?: string;
  readonly inputValue?: string;
  readonly json?: boolean;
  readonly jsonInputValue?: string;
  readonly key?: string;
  readonly llmJSON?: string;
  readonly objectPath: string;
}

export type CLILibraryAction =
  | "clear"
  | "create"
  | "delete"
  | "get"
  | "list"
  | "put"
  | "remove"
  | "set";

export interface CLILibraryArguments {
  readonly action: CLILibraryAction;
  readonly inputPath?: string | undefined;
  readonly inputValue?: string | undefined;
  readonly json?: boolean | undefined;
  readonly jsonInputValue?: string | undefined;
  readonly key?: string | undefined;
  readonly path?: string | undefined;
  readonly target: ParsedWikiGraphLibraryUri;
}

export type CLILocalConfigAction =
  | "clear"
  | "delete"
  | "get"
  | "put"
  | "set"
  | "test";

export interface CLILocalConfigArguments {
  readonly action: CLILocalConfigAction;
  readonly inputValue?: string;
  readonly json?: boolean;
  readonly jsonInputValue?: string;
  readonly key?: string;
  readonly section: LocalConfigSection;
  readonly secret?: boolean;
}

export interface CLIGcArguments {
  readonly dryRun?: boolean;
  readonly force?: boolean;
  readonly json?: boolean;
}

export interface CLILegacyArguments {
  readonly action: "migrate";
  readonly inputPath: string;
  readonly outputPath?: string;
}

export type CLIQueueAction =
  | "add"
  | "boost"
  | "cancel"
  | "clean"
  | "list"
  | "pause"
  | "resume"
  | "status"
  | "target"
  | "watch";

export type CLIObjectKind =
  | "chunk"
  | "chapter"
  | "entity"
  | "meta"
  | "source"
  | "summary"
  | "triple";
export type CLIResultFormat = "json" | "jsonl" | "text";

export interface CLIQueueArguments {
  readonly action: CLIQueueAction;
  readonly acceptCost?: boolean;
  readonly activeOnly?: boolean;
  readonly all?: boolean;
  readonly archivePath?: string;
  readonly boost?: boolean;
  readonly chapterId?: number;
  readonly chapterPath?: string;
  readonly from?: "beginning" | "now";
  readonly inputPath?: string;
  readonly jobId?: string;
  readonly json?: boolean;
  readonly jsonl?: boolean;
  readonly llmJSON?: string;
  readonly prompt?: string;
  readonly target?: BuildJobTarget;
}

export type CLIArchiveAction =
  | "create"
  | "evidence"
  | "export"
  | "get"
  | "inspect"
  | "list"
  | "next"
  | "pack"
  | "related"
  | "search";

export type CLIArchiveMaintenanceCommand = "chapter" | "cover" | "meta";
export type CLIArchiveIndexAction =
  | "disable"
  | "embed"
  | "enable"
  | "external"
  | "get";
export type CLIArchiveRootAction = CLIArchiveAction;
export type CLIArchiveUriAction =
  | CLIArchiveRootAction
  | CLIArchiveChapterAction
  | CLIArchiveIndexAction
  | CLIMetadataAction;
export type CLIJobAction =
  | "add"
  | "boost"
  | "cancel"
  | "clean"
  | "get"
  | "list"
  | "pause"
  | "resume"
  | "set"
  | "watch";
export type ArchiveUriLens = Exclude<CLIObjectKind, "meta">;
export type ChapterStateUriTarget =
  | "knowledge-graph"
  | "reading-graph"
  | "reading-summary"
  | "source";

export interface CLIArchiveArguments {
  readonly action: CLIArchiveAction;
  readonly all?: boolean;
  readonly archivePath: string;
  readonly budget?: number;
  readonly backlinks?: boolean;
  readonly chapters?: readonly number[];
  readonly chapterId?: number;
  readonly confirm?: boolean;
  readonly context?: number;
  readonly cursor?: string;
  readonly evidenceLimit?: number;
  readonly format?: CLIResultFormat;
  readonly inputFormat?: CLIFormat;
  readonly importPath?: string;
  readonly json?: boolean;
  readonly jsonl?: boolean;
  readonly kinds?: readonly CLIObjectKind[];
  readonly limit?: number;
  readonly llmJSON?: string;
  readonly objectId?: string;
  readonly outputFormat?: CLIFormat;
  readonly outputPath?: string;
  readonly prompt?: string;
  readonly query?: string;
  readonly replace?: boolean;
  readonly reverse?: boolean;
  readonly role?: "any" | "object" | "self" | "subject";
  readonly triplePattern?: ArchiveTriplePattern;
}

export interface CLIArchiveIndexArguments {
  readonly action: CLIArchiveIndexAction;
  readonly archivePath: string;
  readonly json?: boolean;
  readonly jsonl?: boolean;
}

export interface ArchiveMetaFlagValues {
  readonly author?: readonly string[];
  readonly "clear-authors"?: boolean;
  readonly "clear-description"?: boolean;
  readonly "clear-identifier"?: boolean;
  readonly "clear-language"?: boolean;
  readonly "clear-published-at"?: boolean;
  readonly "clear-publisher"?: boolean;
  readonly "clear-title"?: boolean;
  readonly description?: string;
  readonly identifier?: string;
  readonly language?: string;
  readonly "published-at"?: string;
  readonly publisher?: string;
  readonly title?: string;
}

export interface ArchiveArgumentValues extends ArchiveMetaFlagValues {
  readonly "accept-cost"?: boolean;
  readonly active?: boolean;
  readonly after?: string;
  readonly all?: boolean;
  readonly backlinks?: boolean;
  readonly before?: string;
  readonly boost?: boolean;
  readonly budget?: string;
  readonly chapter?: string;
  readonly clear?: boolean;
  readonly confirm?: boolean;
  readonly context?: string;
  readonly cursor?: string;
  readonly "digest-dir"?: string;
  readonly "dry-run"?: boolean;
  readonly evidence?: string;
  readonly first?: boolean;
  readonly force?: boolean;
  readonly from?: string;
  readonly help?: boolean;
  readonly import?: string;
  readonly input?: string;
  readonly "input-format"?: string;
  readonly json?: boolean;
  readonly "json-input"?: string;
  readonly jsonl?: boolean;
  readonly limit?: string;
  readonly llm?: string;
  readonly output?: string;
  readonly "output-format"?: string;
  readonly parent?: string;
  readonly path?: string;
  readonly predicate?: string;
  readonly prompt?: string;
  readonly query?: string;
  readonly replace?: boolean;
  readonly reverse?: boolean;
  readonly role?: string;
  readonly root?: boolean;
  readonly secret?: boolean;
  readonly stage?: string;
  readonly last?: boolean;
  readonly task?: string;
  readonly to?: string;
  readonly verbose?: boolean;
}

export type ParsedCLIArguments =
  | {
      readonly help: false;
      readonly kind: "version";
    }
  | {
      readonly args: CLIArguments;
      readonly help: false;
      readonly kind: "convert";
    }
  | {
      readonly args: CLIArguments;
      readonly help: true;
      readonly helpText: string;
      readonly kind: "convert";
    }
  | {
      readonly args: CLIArchiveMetadataArguments;
      readonly help: false;
      readonly kind: "meta";
    }
  | {
      readonly args: CLIArchiveCoverArguments;
      readonly help: false;
      readonly kind: "cover";
    }
  | {
      readonly args?: CLIArchiveMetadataArguments | CLIArchiveCoverArguments;
      readonly help: true;
      readonly helpText: string;
      readonly kind: "maintenance";
    }
  | {
      readonly args: CLIArchiveChapterArguments;
      readonly help: false;
      readonly kind: "chapter";
    }
  | {
      readonly help: true;
      readonly helpText: string;
      readonly kind: "chapter";
    }
  | {
      readonly args: CLIObjectMetadataArguments;
      readonly help: false;
      readonly kind: "object-metadata";
    }
  | {
      readonly args: CLILibraryArguments;
      readonly help: false;
      readonly kind: "library";
    }
  | {
      readonly args: CLIArchiveArguments;
      readonly help: false;
      readonly kind: "archive";
    }
  | {
      readonly args: CLIArchiveIndexArguments;
      readonly help: false;
      readonly kind: "archive-index";
    }
  | {
      readonly args: CLIQueueArguments;
      readonly help: false;
      readonly kind: "queue";
    }
  | {
      readonly help: true;
      readonly helpText: string;
      readonly kind: "help";
    }
  | {
      readonly args: CLIGcArguments;
      readonly help: false;
      readonly kind: "gc";
    }
  | {
      readonly args: CLILocalConfigArguments;
      readonly help: false;
      readonly kind: "local-config";
    }
  | {
      readonly args: CLILegacyArguments;
      readonly help: false;
      readonly kind: "legacy";
    };
