import { parseArgs } from "util";

import { type CLIFormat, parseCLIFormat } from "./formats.js";
import {
  CLI_HELP_ROUTES,
  archiveMaintenanceHelpRoute,
  withHelpRoute,
} from "./errors.js";
import {
  type ArchiveTriplePattern,
  type BuildJobTarget,
  type ChapterStage,
} from "../facade/index.js";
import {
  parseHelpTopic,
  parseHelpMatrixPage,
  renderArchiveCommandHelpText,
  renderArchiveMaintenanceCommandHelpText,
  renderHelpMatrixText,
  renderHelpTopicText,
  renderLegacyCommandHelpText,
  renderMainHelpText,
  renderQueueCommandHelpText,
  renderArchiveMaintenanceChapterActionHelpText,
  renderStatusHelpText,
  renderTransformHelpText,
} from "./help.js";
import {
  formatLocatedChapterResourceUri,
  formatLocatedChapterSourceCollectionUri,
  formatLocatedChapterUri,
  parseLocatedWikiGraphUri,
} from "../facade/archive-uri.js";

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
  readonly addStage?: Extract<ChapterStage, "planned" | "sourced">;
  readonly afterChapterId?: number;
  readonly beforeChapterId?: number;
  readonly chapterId?: number;
  readonly clearTitle?: boolean;
  readonly dryRun?: boolean;
  readonly first?: boolean;
  readonly inputFormat?: Extract<CLIFormat, "markdown" | "txt">;
  readonly inputPath?: string;
  readonly json?: boolean;
  readonly last?: boolean;
  readonly llmJSON?: string;
  readonly moveToRoot?: boolean;
  readonly parentChapterId?: number;
  readonly path: string;
  readonly prompt?: string;
  readonly recursive?: boolean;
  readonly resetStage?: Exclude<ChapterStage, "summarized">;
  readonly title?: string;
  readonly treeAction?: "apply" | "show";
}

export interface CLIStatusArguments {
  readonly llmJSON?: string;
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
  | "watch"
  | "worker";

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
  readonly from?: "beginning" | "now";
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
  | "estimate"
  | "export"
  | "get"
  | "list"
  | "next"
  | "pack"
  | "related"
  | "search";

export type CLIArchiveMaintenanceCommand = "chapter" | "cover" | "meta";
type CLIArchiveRootAction = CLIArchiveAction | "set" | "queue";
type CLIArchiveUriAction = CLIArchiveRootAction | CLIArchiveChapterAction;
type CLIJobAction = CLIQueueAction | "get" | "set";
type ArchiveUriLens = Exclude<CLIObjectKind, "meta">;
type ChapterStateUriTarget =
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
  readonly role?: "any" | "object" | "self" | "subject";
  readonly sourcePath?: string;
  readonly targetStage?: ChapterStage;
  readonly triplePattern?: ArchiveTriplePattern;
}

interface ArchiveMetaFlagValues {
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

interface ArchiveArgumentValues extends ArchiveMetaFlagValues {
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
  readonly from?: string;
  readonly help?: boolean;
  readonly input?: string;
  readonly "input-format"?: string;
  readonly json?: boolean;
  readonly jsonl?: boolean;
  readonly limit?: string;
  readonly llm?: string;
  readonly output?: string;
  readonly "output-format"?: string;
  readonly parent?: string;
  readonly predicate?: string;
  readonly prompt?: string;
  readonly role?: string;
  readonly root?: boolean;
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
      readonly args: CLIArchiveArguments;
      readonly help: false;
      readonly kind: "archive";
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
      readonly args: CLIStatusArguments;
      readonly help: false;
      readonly kind: "config-status";
    }
  | {
      readonly args: CLIStatusArguments;
      readonly help: true;
      readonly helpText: string;
      readonly kind: "config-status";
    }
  | {
      readonly args: CLILegacyArguments;
      readonly help: false;
      readonly kind: "legacy";
    };

export function parseCLIArguments(
  argv = process.argv.slice(2),
): ParsedCLIArguments {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    args: normalizeArchiveValueFlagArgv(argv),
    options: {
      author: {
        multiple: true,
        type: "string",
      },
      after: {
        type: "string",
      },
      before: {
        type: "string",
      },
      backlinks: {
        type: "boolean",
      },
      budget: {
        type: "string",
      },
      clear: {
        type: "boolean",
      },
      "clear-authors": {
        type: "boolean",
      },
      "clear-description": {
        type: "boolean",
      },
      "clear-identifier": {
        type: "boolean",
      },
      "clear-language": {
        type: "boolean",
      },
      "clear-published-at": {
        type: "boolean",
      },
      "clear-publisher": {
        type: "boolean",
      },
      "clear-title": {
        type: "boolean",
      },
      description: {
        type: "string",
      },
      help: {
        short: "h",
        type: "boolean",
      },
      "digest-dir": {
        type: "string",
      },
      "dry-run": {
        type: "boolean",
      },
      active: {
        type: "boolean",
      },
      "accept-cost": {
        type: "boolean",
      },
      all: {
        type: "boolean",
      },
      boost: {
        type: "boolean",
      },
      first: {
        type: "boolean",
      },
      identifier: {
        type: "string",
      },
      from: {
        type: "string",
      },
      input: {
        type: "string",
      },
      "input-format": {
        type: "string",
      },
      limit: {
        type: "string",
      },
      language: {
        type: "string",
      },
      json: {
        type: "boolean",
      },
      jsonl: {
        type: "boolean",
      },
      llm: {
        type: "string",
      },
      output: {
        type: "string",
      },
      "output-format": {
        type: "string",
      },
      prompt: {
        type: "string",
      },
      stage: {
        type: "string",
      },
      task: {
        type: "string",
      },
      chapter: {
        type: "string",
      },
      confirm: {
        type: "boolean",
      },
      context: {
        type: "string",
      },
      cursor: {
        type: "string",
      },
      evidence: {
        type: "string",
      },
      parent: {
        type: "string",
      },
      "published-at": {
        type: "string",
      },
      publisher: {
        type: "string",
      },
      recursive: {
        type: "boolean",
      },
      role: {
        type: "string",
      },
      root: {
        type: "boolean",
      },
      last: {
        type: "boolean",
      },
      title: {
        type: "string",
      },
      to: {
        type: "string",
      },
      verbose: {
        short: "v",
        type: "boolean",
      },
      version: {
        type: "boolean",
      },
    },
    strict: true,
  });

  if (values.version === true) {
    return {
      help: false,
      kind: "version",
    };
  }

  if (values.help === true && positionals.length === 0) {
    return {
      help: true,
      helpText: renderMainHelpText(),
      kind: "help",
    };
  }

  if (
    values["accept-cost"] === true &&
    !(positionals[0] === "queue" && positionals[1] === "add") &&
    !(
      isWikiGraphUri(positionals[0]) &&
      positionals[1] === "queue" &&
      positionals[2] === "add"
    )
  ) {
    throw new Error(
      withHelpRoute(
        "`--accept-cost` is only valid for `wikigraph queue add`.",
        "wikigraph queue --help",
      ),
    );
  }

  if (positionals[0] === "help") {
    return parseHelpArguments(positionals.slice(1), values);
  }

  if (positionals[0] === "config") {
    return parseConfigArguments(positionals.slice(1), values);
  }

  if (positionals[0] === "queue") {
    return parseQueueArguments(positionals.slice(1), values);
  }

  if (positionals[0] === "legacy") {
    return parseLegacyArguments(positionals.slice(1), values);
  }

  if (positionals[0] === "transform") {
    return parseTransformArguments(positionals.slice(1), values);
  }

  if (positionals[0] === "next") {
    return parseArchiveArguments("next", positionals.slice(1), values);
  }

  if (
    isArchiveMaintenanceCommand(positionals[0]) &&
    values.help === true &&
    positionals.length <= 2
  ) {
    return parseArchiveMaintenanceArguments(
      positionals[0],
      positionals.slice(1),
      values,
    );
  }

  if (isWikiGraphJobUri(positionals[0])) {
    return parseJobUriFirstArguments(positionals, values);
  }

  if (isWikiGraphUri(positionals[0])) {
    return parseArchiveUriFirstArguments(positionals, values);
  }

  if (
    isArchiveAction(positionals[0]) &&
    values.help === true &&
    positionals.length === 1
  ) {
    return parseArchiveArguments(positionals[0], positionals.slice(1), values);
  }

  if (positionals.length === 0) {
    throw new Error(withHelpRoute("Missing command.", CLI_HELP_ROUTES.command));
  }
  if (positionals.some((positional) => looksLikeSdpubPath(positional))) {
    throw new Error(formatLegacySdpubPathMessage());
  }
  throw new Error(formatUnknownCommandMessage(positionals[0]!));
}

function parseArchiveUriFirstArguments(
  positionals: readonly string[],
  values: ArchiveArgumentValues,
): ParsedCLIArguments {
  const uri = positionals[0];
  const action = positionals[1] ?? "get";

  if (uri === undefined) {
    throw new Error("Internal error: missing URI-first archive URI.");
  }

  if (!isArchiveUriAction(action)) {
    throw new Error(
      withHelpRoute(
        `The URI-first form does not support \`${action}\`. Use \`wikigraph help object\` to inspect valid object/verb pairs.`,
        "wikigraph help object",
      ),
    );
  }

  return parseArchiveUriTargetArguments(
    uri,
    action,
    positionals[1] === undefined ? [] : positionals.slice(2),
    values,
  );
}

function parseArchiveUriTargetArguments(
  uri: string,
  action: CLIArchiveUriAction,
  tail: readonly string[],
  values: ArchiveArgumentValues,
): ParsedCLIArguments {
  const parsed = parseLocatedWikiGraphUri(uri);
  const archivePath = parsed.archivePath;
  const objectUri = parsed.objectUri;
  const helpRoute = `wikigraph ${uri} ${action} --help`;

  if (archivePath === undefined) {
    throw new Error(formatMissingArchiveLocatorMessage(uri));
  }

  if (action === "queue") {
    return parseArchiveUriQueueArguments(
      uri,
      archivePath,
      objectUri,
      tail,
      values,
    );
  }

  if (objectUri === undefined) {
    return parseArchiveUriArchiveArguments(
      uri,
      archivePath,
      action,
      tail,
      values,
      helpRoute,
    );
  }

  if (objectUri === "wkg://cover") {
    return parseArchiveCoverUriArguments(
      uri,
      archivePath,
      action,
      tail,
      values,
    );
  }

  const chapterTarget = parseChapterTarget(objectUri);
  if (chapterTarget !== undefined) {
    return parseArchiveChapterUriArguments(
      uri,
      archivePath,
      chapterTarget,
      action,
      tail,
      values,
    );
  }

  if (!isUriFirstArchiveAction(action)) {
    throw new Error(
      withHelpRoute(
        `The URI target ${uri} does not support \`${action}\`. Use \`wikigraph help object\` to inspect valid object/verb pairs.`,
        "wikigraph help object",
      ),
    );
  }

  return parseArchiveArguments(action, [uri, ...tail], values, helpRoute);
}

function parseArchiveUriArchiveArguments(
  uri: string,
  archivePath: string,
  action: CLIArchiveUriAction,
  tail: readonly string[],
  values: ArchiveArgumentValues,
  helpRoute: string,
): ParsedCLIArguments {
  if (action === "set") {
    return parseArchiveRootSetArguments(archivePath, tail, values, helpRoute);
  }

  if (!isArchiveAction(action)) {
    throw new Error(
      withHelpRoute(
        `The archive URI form does not support \`${action}\`. Use \`wikigraph help object archive\` to inspect valid verbs.`,
        "wikigraph help object archive",
      ),
    );
  }

  if (action === "get") {
    return parseArchiveArguments(action, [uri, ...tail], values, helpRoute);
  }

  if (
    action !== "create" &&
    action !== "estimate" &&
    action !== "export" &&
    action !== "list" &&
    action !== "search"
  ) {
    throw new Error(
      withHelpRoute(
        `The archive URI ${uri} cannot be used with \`${action}\`; use a concrete object URI. Use \`wikigraph help object archive\` to inspect valid archive verbs.`,
        "wikigraph help object archive",
      ),
    );
  }

  return parseArchiveArguments(
    action,
    [
      action === "create" || action === "estimate" || action === "export"
        ? archivePath
        : uri,
      ...tail,
    ],
    values,
    helpRoute,
  );
}

function parseArchiveRootSetArguments(
  archivePath: string,
  tail: readonly string[],
  values: ArchiveArgumentValues,
  helpRoute: string,
): ParsedCLIArguments {
  if (values.help === true) {
    return {
      help: true,
      helpText: renderArchiveMaintenanceCommandHelpText("meta"),
      kind: "maintenance",
    };
  }

  rejectArchiveMaintenanceExtraPositionals("meta", tail, 0, helpRoute);
  rejectMetaCommandFlag("budget", values.budget, helpRoute);
  rejectMetaCommandFlag("chapter", values.chapter, helpRoute);
  rejectMetaCommandFlag("cursor", values.cursor, helpRoute);
  rejectMetaCommandFlag("digest-dir", values["digest-dir"], helpRoute);
  rejectMetaCommandFlag("input", values.input, helpRoute);
  rejectMetaCommandFlag("input-format", values["input-format"], helpRoute);
  rejectMetaCommandFlag("limit", values.limit, helpRoute);
  rejectMetaCommandFlag("output", values.output, helpRoute);
  rejectMetaCommandFlag("output-format", values["output-format"], helpRoute);
  rejectMetaCommandFlag("prompt", values.prompt, helpRoute);
  rejectMetaCommandFlag("stage", values.stage, helpRoute);
  rejectMetaCommandFlag("to", values.to, helpRoute);
  rejectMetaCommandBooleanFlag("confirm", values.confirm, helpRoute);
  rejectMetaCommandBooleanFlag("json", values.json, helpRoute);

  if (values.verbose === true) {
    throw new Error(
      withHelpRoute(
        "The archive root `set` command does not support --verbose.",
        helpRoute,
      ),
    );
  }

  const metaPatch = parseArchiveMetaPatch(values, "meta");
  if (metaPatch === undefined) {
    throw new Error(
      withHelpRoute(
        "Missing metadata edit flags. Use --title, --author, or a --clear-* flag.",
        helpRoute,
      ),
    );
  }

  return {
    args: {
      inputPath: archivePath,
      ...(values.llm === undefined ? {} : { llmJSON: values.llm }),
      metaPatch,
    },
    help: false,
    kind: "meta",
  };
}

function parseArchiveCoverUriArguments(
  uri: string,
  archivePath: string,
  action: CLIArchiveUriAction,
  tail: readonly string[],
  values: ArchiveArgumentValues,
): ParsedCLIArguments {
  const helpRoute = `wikigraph ${uri} ${action} --help`;

  if (values.help === true) {
    return {
      help: true,
      helpText: renderArchiveMaintenanceCommandHelpText("cover"),
      kind: "maintenance",
    };
  }

  if (action !== "get") {
    throw new Error(
      withHelpRoute(
        `The cover object does not support \`${action}\`. Expected get.`,
        "wikigraph help object cover",
      ),
    );
  }

  rejectArchiveMaintenanceExtraPositionals("cover", tail, 0, helpRoute);
  rejectCoverCommandFlag("budget", values.budget, helpRoute);
  rejectCoverCommandFlag("chapter", values.chapter, helpRoute);
  rejectCoverCommandFlag("cursor", values.cursor, helpRoute);
  rejectCoverCommandFlag("digest-dir", values["digest-dir"], helpRoute);
  rejectCoverCommandFlag("input", values.input, helpRoute);
  rejectCoverCommandFlag("input-format", values["input-format"], helpRoute);
  rejectCoverCommandFlag("limit", values.limit, helpRoute);
  rejectCoverCommandFlag("output", values.output, helpRoute);
  rejectCoverCommandFlag("output-format", values["output-format"], helpRoute);
  rejectCoverCommandFlag("prompt", values.prompt, helpRoute);
  rejectCoverCommandFlag("stage", values.stage, helpRoute);
  rejectCoverCommandFlag("to", values.to, helpRoute);
  rejectCoverCommandBooleanFlag("confirm", values.confirm, helpRoute);
  rejectCoverCommandBooleanFlag("json", values.json, helpRoute);
  rejectCoverMetaFlags(values);

  if (values.verbose === true) {
    throw new Error(
      withHelpRoute("The cover command does not support --verbose.", helpRoute),
    );
  }

  return {
    args: {
      inputPath: archivePath,
      ...(values.llm === undefined ? {} : { llmJSON: values.llm }),
    },
    help: false,
    kind: "cover",
  };
}

type ChapterUriTarget =
  | { readonly kind: "collection" }
  | { readonly kind: "lens"; readonly lens: ArchiveUriLens }
  | {
      readonly kind: "triple-pattern-lens";
      readonly pattern: ArchiveTriplePattern;
    }
  | { readonly kind: "tree" }
  | { readonly chapterId: number; readonly kind: "chapter" }
  | {
      readonly chapterId: number;
      readonly kind: "chapter-lens";
      readonly lens: ArchiveUriLens;
    }
  | {
      readonly chapterId: number;
      readonly kind: "chapter-triple-pattern-lens";
      readonly pattern: ArchiveTriplePattern;
    }
  | {
      readonly chapterId: number;
      readonly kind: "chapter-state";
      readonly target?: ChapterStateUriTarget;
    }
  | {
      readonly chapterId: number;
      readonly kind: "chapter-resource";
      readonly resource: "source" | "summary" | "title";
    };

function parseChapterTarget(objectUri: string): ChapterUriTarget | undefined {
  if (objectUri === "wkg://chapter") {
    return { kind: "collection" };
  }

  if (objectUri === "wkg://chapter/tree") {
    return { kind: "tree" };
  }

  const archiveLens = parseArchiveUriLensObjectUri(objectUri);
  if (archiveLens !== undefined) {
    return { kind: "lens", lens: archiveLens };
  }

  const archiveTriplePattern = parseTriplePatternObjectUri(objectUri);
  if (archiveTriplePattern !== undefined) {
    return {
      kind: "triple-pattern-lens",
      pattern: archiveTriplePattern,
    };
  }

  const match = /^wkg:\/\/chapter\/([1-9][0-9]*)(?:\/(.*))?\/?$/u.exec(
    objectUri,
  );

  if (match?.[1] === undefined) {
    return undefined;
  }

  const chapterId = Number(match[1]);
  const suffix = match[2] === "" ? undefined : match[2];
  const chapterTriplePattern =
    suffix === undefined ? undefined : parseTriplePatternSuffix(suffix);

  if (chapterTriplePattern !== undefined) {
    return {
      chapterId,
      kind: "chapter-triple-pattern-lens",
      pattern: chapterTriplePattern,
    };
  }

  const chapterStateTarget = parseChapterStateSuffix(suffix);

  if (chapterStateTarget !== undefined) {
    return {
      chapterId,
      kind: "chapter-state",
      ...(chapterStateTarget === "all" ? {} : { target: chapterStateTarget }),
    };
  }

  const resource = parseChapterResourceSuffix(suffix);

  if (suffix !== undefined && resource === undefined) {
    return undefined;
  }

  if (resource === undefined) {
    return { chapterId, kind: "chapter" };
  }
  if (resource === "state") {
    return { chapterId, kind: "chapter-state" };
  }
  if (resource === "chunk" || resource === "entity" || resource === "triple") {
    return { chapterId, kind: "chapter-lens", lens: resource };
  }
  if (resource === "source" || resource === "summary") {
    return { chapterId, kind: "chapter-resource", resource };
  }

  return { chapterId, kind: "chapter-resource", resource };
}

function parseChapterStateSuffix(
  suffix: string | undefined,
): ChapterStateUriTarget | "all" | undefined {
  if (suffix === "state") {
    return "all";
  }

  switch (suffix) {
    case "state/source":
      return "source";
    case "state/reading-graph":
      return "reading-graph";
    case "state/reading-summary":
      return "reading-summary";
    case "state/knowledge-graph":
      return "knowledge-graph";
    default:
      return undefined;
  }
}

function parseChapterResourceSuffix(
  suffix: string | undefined,
):
  | "chunk"
  | "entity"
  | "source"
  | "state"
  | "summary"
  | "title"
  | "triple"
  | undefined {
  switch (suffix) {
    case undefined:
    case "chunk":
    case "entity":
    case "source":
    case "state":
    case "summary":
    case "title":
    case "triple":
      return suffix;
    default:
      return undefined;
  }
}

function parseTriplePatternObjectUri(
  objectUri: string,
): ArchiveTriplePattern | undefined {
  if (!objectUri.startsWith("wkg://triple/")) {
    return undefined;
  }

  return parseTriplePatternSuffix(objectUri.slice("wkg://".length));
}

function parseTriplePatternSuffix(
  suffix: string,
): ArchiveTriplePattern | undefined {
  const parts = suffix.split("/");

  if (parts[0] !== "triple" || parts.length < 2 || parts.length > 4) {
    return undefined;
  }

  const [subject = "_", predicate = "_", object = "_"] = parts.slice(1);
  const hasPlaceholder = parts.slice(1).includes("_");
  const hasOmittedTrailingPlaceholder = parts.length < 4;

  if (!hasPlaceholder && !hasOmittedTrailingPlaceholder) {
    return undefined;
  }

  if (
    !isTriplePatternQidSegment(subject) ||
    !isTriplePatternPredicateSegment(predicate) ||
    !isTriplePatternQidSegment(object)
  ) {
    return undefined;
  }

  return {
    ...(object === "_" ? {} : { objectQid: object }),
    ...(predicate === "_" ? {} : { predicate: decodeURIComponent(predicate) }),
    ...(subject === "_" ? {} : { subjectQid: subject }),
  };
}

function isTriplePatternQidSegment(value: string): boolean {
  return value === "_" || /^Q[1-9][0-9]*$/u.test(value);
}

function isTriplePatternPredicateSegment(value: string): boolean {
  return value === "_" || (value !== "" && !value.includes("/"));
}

function parseArchiveUriLensObjectUri(
  objectUri: string,
): ArchiveUriLens | undefined {
  switch (objectUri) {
    case "wkg://chapter":
      return "chapter";
    case "wkg://chunk":
      return "chunk";
    case "wkg://entity":
      return "entity";
    case "wkg://source":
      return "source";
    case "wkg://summary":
      return "summary";
    case "wkg://triple":
      return "triple";
    default:
      return undefined;
  }
}

function parseArchiveChapterUriArguments(
  uri: string,
  archivePath: string,
  target: ChapterUriTarget,
  action: CLIArchiveUriAction,
  tail: readonly string[],
  values: ArchiveArgumentValues,
): ParsedCLIArguments {
  const helpRoute = `wikigraph ${uri} ${action} --help`;

  switch (target.kind) {
    case "collection":
      return parseChapterCollectionUriArguments(
        uri,
        archivePath,
        action,
        tail,
        values,
        helpRoute,
      );
    case "lens":
      return parseArchiveLensUriArguments(
        uri,
        target.lens,
        action,
        tail,
        values,
        helpRoute,
      );
    case "triple-pattern-lens":
      return parseArchiveTriplePatternLensUriArguments(
        uri,
        target.pattern,
        action,
        tail,
        values,
        helpRoute,
      );
    case "tree":
      return parseChapterTreeUriArguments(
        archivePath,
        action,
        tail,
        values,
        helpRoute,
      );
    case "chapter":
      return parseSingleChapterUriArguments(
        archivePath,
        target.chapterId,
        action,
        tail,
        values,
        helpRoute,
      );
    case "chapter-lens":
      return parseChapterLensUriArguments(
        archivePath,
        target.chapterId,
        target.lens,
        action,
        tail,
        values,
        helpRoute,
      );
    case "chapter-triple-pattern-lens":
      return parseChapterTriplePatternLensUriArguments(
        archivePath,
        target.chapterId,
        target.pattern,
        action,
        tail,
        values,
        helpRoute,
      );
    case "chapter-state":
      return parseChapterStateUriArguments(
        uri,
        action,
        tail,
        values,
        helpRoute,
      );
    case "chapter-resource":
      return parseChapterResourceUriArguments(
        archivePath,
        target.chapterId,
        target.resource,
        action,
        tail,
        values,
        helpRoute,
      );
  }
}

function parseChapterCollectionUriArguments(
  uri: string,
  archivePath: string,
  action: CLIArchiveUriAction,
  tail: readonly string[],
  values: ArchiveArgumentValues,
  helpRoute: string,
): ParsedCLIArguments {
  if (action === "list" || action === "search") {
    return parseArchiveLensUriArguments(
      uri,
      "chapter",
      action,
      tail,
      values,
      helpRoute,
    );
  }

  if (action !== "add") {
    throw new Error(
      withHelpRoute(
        `The chapter collection does not support \`${action}\`. Expected add, list, or search.`,
        "wikigraph help object chapter",
      ),
    );
  }

  return parseArchiveChapterLikeArguments(
    action,
    archivePath,
    tail,
    values,
    helpRoute,
  );
}

function parseArchiveLensUriArguments(
  uri: string,
  lens: ArchiveUriLens,
  action: CLIArchiveUriAction,
  tail: readonly string[],
  values: ArchiveArgumentValues,
  helpRoute: string,
): ParsedCLIArguments {
  if (action !== "list" && action !== "search") {
    throw new Error(
      withHelpRoute(
        `The ${lens} collection does not support \`${action}\`. Expected list or search.`,
        `wikigraph help object ${lens}`,
      ),
    );
  }

  return parseArchiveArguments(action, [uri, ...tail], values, helpRoute, {
    defaultKinds: [lens],
  });
}

function parseArchiveTriplePatternLensUriArguments(
  uri: string,
  pattern: ArchiveTriplePattern,
  action: CLIArchiveUriAction,
  tail: readonly string[],
  values: ArchiveArgumentValues,
  helpRoute: string,
): ParsedCLIArguments {
  if (action !== "list" && action !== "search") {
    throw new Error(
      withHelpRoute(
        `The triple pattern collection does not support \`${action}\`. Expected list or search.`,
        "wikigraph help object triple",
      ),
    );
  }

  return parseArchiveArguments(action, [uri, ...tail], values, helpRoute, {
    defaultKinds: ["triple"],
    triplePattern: pattern,
  });
}

function parseChapterTreeUriArguments(
  archivePath: string,
  action: CLIArchiveUriAction,
  tail: readonly string[],
  values: ArchiveArgumentValues,
  helpRoute: string,
): ParsedCLIArguments {
  if (action !== "get" && action !== "set") {
    throw new Error(
      withHelpRoute(
        `The chapter tree does not support \`${action}\`. Expected get or set.`,
        "wikigraph help object chapter-tree",
      ),
    );
  }

  return parseArchiveChapterLikeArguments(
    "tree",
    archivePath,
    tail,
    values,
    helpRoute,
    action === "set" ? "apply" : undefined,
  );
}

function parseSingleChapterUriArguments(
  archivePath: string,
  chapterId: number,
  action: CLIArchiveUriAction,
  tail: readonly string[],
  values: ArchiveArgumentValues,
  helpRoute: string,
): ParsedCLIArguments {
  switch (action) {
    case "search":
    case "list":
      return parseArchiveArguments(
        action,
        [formatLocatedChapterUri(archivePath, chapterId), ...tail],
        values,
        helpRoute,
      );
    case "get":
      return parseArchiveArguments(
        "get",
        [formatLocatedChapterUri(archivePath, chapterId), ...tail],
        values,
        helpRoute,
      );
    case "move":
    case "remove":
    case "reset":
      return parseArchiveChapterLikeArguments(
        action,
        archivePath,
        tail,
        { ...values, chapter: String(chapterId) },
        helpRoute,
      );
    case "queue":
      return parseArchiveUriQueueArguments(
        formatLocatedChapterUri(archivePath, chapterId),
        archivePath,
        `wkg://chapter/${chapterId}`,
        tail,
        values,
      );
    default:
      throw new Error(
        withHelpRoute(
          `The chapter object does not support \`${action}\`.`,
          "wikigraph help object chapter",
        ),
      );
  }
}

function parseChapterLensUriArguments(
  archivePath: string,
  chapterId: number,
  lens: ArchiveUriLens,
  action: CLIArchiveUriAction,
  tail: readonly string[],
  values: ArchiveArgumentValues,
  helpRoute: string,
): ParsedCLIArguments {
  if (action !== "list" && action !== "search") {
    throw new Error(
      withHelpRoute(
        `The chapter ${lens} collection does not support \`${action}\`. Expected list or search.`,
        `wikigraph help object ${lens}`,
      ),
    );
  }

  return parseArchiveArguments(
    action,
    [formatLocatedChapterUri(archivePath, chapterId), ...tail],
    values,
    helpRoute,
    { defaultKinds: [lens] },
  );
}

function parseChapterTriplePatternLensUriArguments(
  archivePath: string,
  chapterId: number,
  pattern: ArchiveTriplePattern,
  action: CLIArchiveUriAction,
  tail: readonly string[],
  values: ArchiveArgumentValues,
  helpRoute: string,
): ParsedCLIArguments {
  if (action !== "list" && action !== "search") {
    throw new Error(
      withHelpRoute(
        `The chapter triple pattern collection does not support \`${action}\`. Expected list or search.`,
        "wikigraph help object triple",
      ),
    );
  }

  return parseArchiveArguments(
    action,
    [formatLocatedChapterUri(archivePath, chapterId), ...tail],
    values,
    helpRoute,
    { defaultKinds: ["triple"], triplePattern: pattern },
  );
}

function parseChapterStateUriArguments(
  uri: string,
  action: CLIArchiveUriAction,
  tail: readonly string[],
  values: ArchiveArgumentValues,
  helpRoute: string,
): ParsedCLIArguments {
  if (action !== "get") {
    throw new Error(
      withHelpRoute(
        `The chapter state object does not support \`${action}\`. Expected get.`,
        "wikigraph help object chapter-state",
      ),
    );
  }

  return parseArchiveArguments("get", [uri, ...tail], values, helpRoute);
}

function parseChapterResourceUriArguments(
  archivePath: string,
  chapterId: number,
  resource: "source" | "summary" | "title",
  action: CLIArchiveUriAction,
  tail: readonly string[],
  values: ArchiveArgumentValues,
  helpRoute: string,
): ParsedCLIArguments {
  if (action === "list" || action === "search") {
    if (resource === "title") {
      throw new Error(
        withHelpRoute(
          `The chapter title resource does not support \`${action}\`. Expected get or set.`,
          "wikigraph help object chapter-title",
        ),
      );
    }

    return parseChapterLensUriArguments(
      archivePath,
      chapterId,
      resource,
      action,
      tail,
      values,
      helpRoute,
    );
  }

  if (action !== "set" && action !== "get") {
    throw new Error(
      withHelpRoute(
        `The chapter ${resource} resource does not support \`${action}\`. Expected get or set.`,
        `wikigraph help object chapter-${resource}`,
      ),
    );
  }

  if (action === "get") {
    const objectUri =
      resource === "source"
        ? formatLocatedChapterSourceCollectionUri(archivePath, chapterId)
        : formatLocatedChapterResourceUri(archivePath, chapterId, resource);

    return parseArchiveArguments(
      "get",
      [objectUri, ...tail],
      values,
      helpRoute,
    );
  }

  const mappedAction =
    resource === "source"
      ? "set-source"
      : resource === "summary"
        ? "set-summary"
        : "set-title";

  return parseArchiveChapterLikeArguments(
    mappedAction,
    archivePath,
    tail,
    { ...values, chapter: String(chapterId) },
    helpRoute,
  );
}

function parseArchiveChapterLikeArguments(
  action: CLIArchiveChapterAction,
  archivePath: string,
  tail: readonly string[],
  values: ArchiveArgumentValues,
  helpRoute: string,
  treeAction?: "apply",
): ParsedCLIArguments {
  if (values.help === true) {
    return {
      help: true,
      helpText: renderArchiveMaintenanceChapterActionHelpText(action),
      kind: "chapter",
    };
  }

  rejectArchiveChapterFlag("digest-dir", values["digest-dir"], helpRoute);
  rejectArchiveChapterFlag("jsonl", values.jsonl, helpRoute);
  rejectArchiveChapterFlag("limit", values.limit, helpRoute);
  rejectArchiveChapterFlag("output", values.output, helpRoute);
  rejectArchiveChapterFlag("output-format", values["output-format"], helpRoute);
  rejectArchiveChapterMetaFlags(values, helpRoute);
  if (values.verbose) {
    throw new Error(
      withHelpRoute(
        "The chapter command does not support --verbose.",
        helpRoute,
      ),
    );
  }

  const maxPositionals = 0;
  if (tail.length > maxPositionals) {
    throw new Error(
      withHelpRoute(
        `Unexpected positional arguments: ${tail.join(" ")}.`,
        helpRoute,
      ),
    );
  }

  return {
    args: normalizeArchiveChapterArguments(
      action,
      archivePath,
      values,
      helpRoute,
      treeAction,
    ),
    help: false,
    kind: "chapter",
  };
}

function parseArchiveUriQueueArguments(
  uri: string,
  archivePath: string,
  objectUri: string | undefined,
  tail: readonly string[],
  values: ArchiveArgumentValues,
): ParsedCLIArguments {
  const queueAction = tail[0];
  const helpRoute = `wikigraph ${uri} queue --help`;

  if (queueAction !== "add") {
    throw new Error(
      withHelpRoute(
        queueAction === undefined
          ? "Missing queue action. Expected add."
          : `Invalid queue action for archive object URI: ${queueAction}. Expected add.`,
        helpRoute,
      ),
    );
  }

  const chapterTarget =
    objectUri === undefined ? undefined : parseChapterTarget(objectUri);
  if (chapterTarget?.kind !== "chapter") {
    throw new Error(
      withHelpRoute("`queue add` requires a chapter URI target.", helpRoute),
    );
  }

  return parseQueueAddArguments(
    archivePath,
    chapterTarget.chapterId,
    tail.slice(1),
    values,
    helpRoute,
  );
}

function parseJobUriFirstArguments(
  positionals: readonly string[],
  values: ArchiveArgumentValues,
): ParsedCLIArguments {
  const uri = positionals[0];
  const action = positionals[1];

  if (uri === undefined) {
    throw new Error("Internal error: missing job URI.");
  }

  if (!isJobUriAction(action)) {
    throw new Error(
      withHelpRoute(
        action === undefined
          ? `Missing action after ${uri}.`
          : `The job URI form does not support \`${action}\`.`,
        "wikigraph queue --help",
      ),
    );
  }

  const jobId = parseWikiGraphJobUri(uri);
  const helpRoute = `wikigraph ${uri} ${action} --help`;

  switch (action) {
    case "list":
      if (jobId !== undefined) {
        throw new Error(
          withHelpRoute("Job list requires `wkg-job://`.", helpRoute),
        );
      }
      return parseQueueArguments(["list", ...positionals.slice(2)], values);
    case "get":
    case "status":
      return parseQueueJobArguments(
        "status",
        jobId,
        positionals.slice(2),
        values,
        helpRoute,
      );
    case "watch":
    case "pause":
    case "resume":
    case "cancel":
    case "boost":
      return parseQueueJobArguments(
        action,
        jobId,
        positionals.slice(2),
        values,
        helpRoute,
      );
    case "set":
    case "target":
      return parseQueueJobArguments(
        "target",
        jobId,
        positionals.slice(2),
        values,
        helpRoute,
      );
  }

  throw new Error(`Internal error: unsupported job URI action ${action}.`);
}

function parseTransformArguments(
  positionals: readonly string[],
  values: ArchiveArgumentValues,
): ParsedCLIArguments {
  const helpRoute = "wikigraph transform --help";

  if (positionals.length > 0) {
    throw new Error(
      withHelpRoute(
        `Unexpected positional arguments: ${positionals.join(" ")}.`,
        helpRoute,
      ),
    );
  }
  rejectTransformMetaFlags(values);
  rejectTransformFlag("budget", values.budget, helpRoute);
  rejectTransformFlag("chapter", values.chapter, helpRoute);
  rejectTransformFlag("confirm", values.confirm, helpRoute);
  rejectTransformFlag("cursor", values.cursor, helpRoute);
  rejectTransformFlag("evidence", values.evidence, helpRoute);
  rejectTransformFlag("json", values.json, helpRoute);
  rejectTransformFlag("limit", values.limit, helpRoute);
  rejectTransformFlag("parent", values.parent, helpRoute);
  rejectTransformFlag("to", values.to, helpRoute);

  const args = {
    ...(values["digest-dir"] === undefined
      ? {}
      : { digestDirPath: values["digest-dir"] }),
    help: values.help ?? false,
    ...(values.input === undefined ? {} : { inputPath: values.input }),
    ...(values["input-format"] === undefined
      ? {}
      : {
          inputFormat: parseCLIFormat(values["input-format"], "--input-format"),
        }),
    ...(values.llm === undefined ? {} : { llmJSON: values.llm }),
    ...(values.output === undefined ? {} : { outputPath: values.output }),
    ...(values["output-format"] === undefined
      ? {}
      : {
          outputFormat: parseCLIFormat(
            values["output-format"],
            "--output-format",
          ),
        }),
    ...(values.prompt === undefined ? {} : { prompt: values.prompt }),
    ...(values.stage === undefined
      ? {}
      : {
          targetStage: parseChapterStage(values.stage, "--stage", helpRoute),
        }),
    verbose: values.verbose ?? false,
  } satisfies CLIArguments;

  if (values.help ?? false) {
    return {
      args,
      help: true,
      helpText: renderTransformHelpText(),
      kind: "convert",
    };
  }

  return {
    args,
    help: false,
    kind: "convert",
  };
}

function parseConfigArguments(
  positionals: readonly string[],
  values: ArchiveArgumentValues & ArchiveMetaFlagValues,
): ParsedCLIArguments {
  const action = positionals[0];

  if (values.help === true && action === undefined) {
    return {
      args: {},
      help: true,
      helpText: renderStatusHelpText(),
      kind: "config-status",
    };
  }

  if (action !== "status") {
    throw new Error(
      withHelpRoute(
        action === undefined
          ? "Missing config action. Expected status."
          : `Invalid config action: ${action}. Expected status.`,
        "wikigraph config status --help",
      ),
    );
  }

  return parseConfigStatusArguments(positionals.slice(1), values);
}

function parseLegacyArguments(
  positionals: readonly string[],
  values: ArchiveArgumentValues,
): ParsedCLIArguments {
  const action = positionals[0];

  if (values.help === true && action === undefined) {
    return {
      help: true,
      helpText: renderLegacyCommandHelpText(),
      kind: "help",
    };
  }
  if (action === "migrate") {
    if (values.help === true) {
      return {
        help: true,
        helpText: renderLegacyCommandHelpText("migrate"),
        kind: "help",
      };
    }

    rejectLegacyFlag("--input", values.input);
    rejectLegacyFlag("--input-format", values["input-format"]);
    rejectLegacyFlag("--output-format", values["output-format"]);
    rejectLegacyFlag("--llm", values.llm);
    rejectLegacyFlag("--prompt", values.prompt);
    rejectLegacyBooleanFlag("--json", values.json);
    rejectLegacyBooleanFlag("--jsonl", values.jsonl);
    rejectLegacyBooleanFlag("--verbose", values.verbose);

    const inputPath = positionals[1];

    if (inputPath === undefined) {
      throw new Error(
        withHelpRoute(
          "Missing legacy input path.",
          "wikigraph legacy migrate --help",
        ),
      );
    }
    if (positionals.length > 2) {
      throw new Error(
        withHelpRoute(
          `Unexpected positional arguments: ${positionals.slice(2).join(" ")}.`,
          "wikigraph legacy migrate --help",
        ),
      );
    }

    return {
      args: {
        action,
        inputPath,
        ...(values.output === undefined ? {} : { outputPath: values.output }),
      },
      help: false,
      kind: "legacy",
    };
  }

  throw new Error(
    withHelpRoute(
      action === undefined
        ? "Missing legacy command."
        : `Invalid legacy command: ${action}.`,
      "wikigraph legacy --help",
    ),
  );
}

function rejectLegacyFlag(flag: string, value: unknown): void {
  if (value !== undefined) {
    throw new Error(
      withHelpRoute(
        `\`wikigraph legacy migrate\` does not support ${flag}.`,
        "wikigraph legacy migrate --help",
      ),
    );
  }
}

function rejectLegacyBooleanFlag(
  flag: string,
  value: boolean | undefined,
): void {
  if (value === true) {
    rejectLegacyFlag(flag, value);
  }
}

function parseQueueArguments(
  positionals: readonly string[],
  values: ArchiveArgumentValues,
): ParsedCLIArguments {
  const action = positionals[0];
  const helpRoute = "wikigraph queue --help";

  if (values.help === true) {
    if (isQueueAction(action)) {
      return {
        help: true,
        helpText: renderQueueCommandHelpText(action),
        kind: "help",
      };
    }
    return {
      help: true,
      helpText: renderQueueCommandHelpText(),
      kind: "help",
    };
  }
  if (!isQueueAction(action)) {
    throw new Error(
      withHelpRoute(
        action === undefined
          ? "Missing queue action."
          : `Invalid queue action: ${action}. Expected add, list, status, watch, pause, resume, cancel, boost, target, clean, or worker.`,
        helpRoute,
      ),
    );
  }
  if (values.verbose === true) {
    throw new Error(
      withHelpRoute(
        "The `queue` command does not support --verbose.",
        helpRoute,
      ),
    );
  }

  switch (action) {
    case "add":
      throw new Error(
        withHelpRoute(
          "`queue add` requires a chapter URI target. Use `wikigraph wkg://<archive.wikg>/chapter/<id> queue add --task <task> --accept-cost`.",
          helpRoute,
        ),
      );
    case "list":
      rejectQueueJSONLFlag(action, values.jsonl, helpRoute);
      rejectQueueExtraPositionals(action, positionals, 1, helpRoute);
      return {
        args: {
          action,
          ...(values.active === undefined ? {} : { activeOnly: values.active }),
          ...(values.all === undefined ? {} : { all: values.all }),
          ...(values.input === undefined
            ? {}
            : { archivePath: requireArchiveUriPath(values.input, helpRoute) }),
          ...(values.json === undefined ? {} : { json: values.json }),
        },
        help: false,
        kind: "queue",
      };
    case "status":
      return parseQueueJobArguments(
        action,
        positionals[1],
        positionals.slice(2),
        values,
        helpRoute,
      );
    case "watch":
      return parseQueueJobArguments(
        action,
        positionals[1],
        positionals.slice(2),
        values,
        helpRoute,
      );
    case "pause":
    case "resume":
    case "cancel":
    case "boost": {
      return parseQueueJobArguments(
        action,
        positionals[1],
        positionals.slice(2),
        values,
        helpRoute,
      );
    }
    case "target":
      return parseQueueJobArguments(
        action,
        positionals[1],
        positionals.slice(2),
        values,
        helpRoute,
      );
    case "clean":
    case "worker":
      rejectQueueJSONFlag(action, values.json, helpRoute);
      rejectQueueJSONLFlag(action, values.jsonl, helpRoute);
      rejectQueueExtraPositionals(action, positionals, 1, helpRoute);
      return {
        args: {
          action,
          ...(values.llm === undefined ? {} : { llmJSON: values.llm }),
        },
        help: false,
        kind: "queue",
      };
  }
}

function rejectQueueJSONFlag(
  action: CLIQueueAction,
  value: boolean | undefined,
  helpRoute: string,
): void {
  if (value !== true) {
    return;
  }

  throw new Error(
    withHelpRoute(
      `\`wikigraph queue ${action}\` does not support --json.`,
      helpRoute,
    ),
  );
}

function parseQueueAddArguments(
  archivePath: string,
  chapterId: number,
  tail: readonly string[],
  values: ArchiveArgumentValues,
  helpRoute: string,
): ParsedCLIArguments {
  const action = "add";

  rejectQueueJSONFlag(action, values.json, helpRoute);
  rejectQueueJSONLFlag(action, values.jsonl, helpRoute);
  rejectQueueFlag(action, "--stage", values.stage, helpRoute);
  rejectQueueFlag(action, "--to", values.to, helpRoute);
  rejectQueueFlag(action, "--chapter", values.chapter, helpRoute);
  rejectQueueExtraPositionals(action, [action, ...tail], 1, helpRoute);

  return {
    args: {
      action,
      ...(values["accept-cost"] === undefined
        ? {}
        : { acceptCost: values["accept-cost"] }),
      archivePath,
      ...(values.boost === undefined ? {} : { boost: values.boost }),
      chapterId,
      ...(values.llm === undefined ? {} : { llmJSON: values.llm }),
      ...(values.prompt === undefined ? {} : { prompt: values.prompt }),
      target: parseBuildJobTarget(values.task),
    },
    help: false,
    kind: "queue",
  };
}

function parseQueueJobArguments(
  action: Exclude<CLIQueueAction, "add" | "clean" | "list" | "worker">,
  jobId: string | undefined,
  tail: readonly string[],
  values: ArchiveArgumentValues,
  helpRoute: string,
): ParsedCLIArguments {
  if (action === "status") {
    rejectQueueJSONLFlag(action, values.jsonl, helpRoute);
  } else if (action === "watch") {
    rejectQueueJSONFlag(action, values.json, helpRoute);
  } else {
    rejectQueueJSONFlag(action, values.json, helpRoute);
    rejectQueueJSONLFlag(action, values.jsonl, helpRoute);
  }

  if (action !== "target") {
    rejectQueueFlag(action, "--stage", values.stage, helpRoute);
    rejectQueueFlag(action, "--to", values.to, helpRoute);
  } else {
    rejectQueueFlag(action, "--stage", values.stage, helpRoute);
    rejectQueueFlag(action, "--to", values.to, helpRoute);
  }

  if (jobId === undefined) {
    throw new Error(
      withHelpRoute(
        `\`wikigraph queue ${action}\` requires <job-id>.`,
        helpRoute,
      ),
    );
  }

  rejectQueueExtraPositionals(action, [action, jobId, ...tail], 2, helpRoute);

  if (action === "watch") {
    const watchFrom = parseWatchFrom(values.from, helpRoute);

    return {
      args: {
        action,
        jobId,
        ...(watchFrom === undefined ? {} : { from: watchFrom }),
        ...(values.jsonl === undefined ? {} : { jsonl: values.jsonl }),
      },
      help: false,
      kind: "queue",
    };
  }

  if (action === "status") {
    return {
      args: {
        action,
        jobId,
        ...(values.json === undefined ? {} : { json: values.json }),
      },
      help: false,
      kind: "queue",
    };
  }

  if (action === "target") {
    return {
      args: {
        action,
        jobId,
        target: parseBuildJobTarget(values.task),
      },
      help: false,
      kind: "queue",
    };
  }

  return {
    args: {
      action,
      jobId,
    },
    help: false,
    kind: "queue",
  };
}

function rejectQueueJSONLFlag(
  action: CLIQueueAction,
  value: boolean | undefined,
  helpRoute: string,
): void {
  if (value !== true) {
    return;
  }

  throw new Error(
    withHelpRoute(
      `\`wikigraph queue ${action}\` does not support --jsonl.`,
      helpRoute,
    ),
  );
}

function rejectQueueFlag(
  action: CLIQueueAction,
  name: string,
  value: string | undefined,
  helpRoute: string,
): void {
  if (value === undefined) {
    return;
  }

  throw new Error(
    withHelpRoute(
      `\`wikigraph queue ${action}\` does not support ${name}.`,
      helpRoute,
    ),
  );
}

function parseArchiveMaintenanceArguments(
  command: CLIArchiveMaintenanceCommand,
  positionals: readonly string[],
  values: ArchiveArgumentValues,
): ParsedCLIArguments {
  if (values.help !== true) {
    throw new Error(
      withHelpRoute(`Unknown command: ${command}.`, CLI_HELP_ROUTES.command),
    );
  }

  switch (command) {
    case "cover":
    case "meta":
      if (positionals.length > 0) {
        throw new Error(
          withHelpRoute(
            `Unexpected positional arguments: ${positionals.join(" ")}.`,
            CLI_HELP_ROUTES.command,
          ),
        );
      }
      return {
        help: true,
        helpText: renderArchiveMaintenanceCommandHelpText(command),
        kind: "maintenance",
      };
    case "chapter": {
      const action = positionals[0];
      if (action === undefined) {
        return {
          help: true,
          helpText: renderArchiveMaintenanceCommandHelpText("chapter"),
          kind: "chapter",
        };
      }
      if (!isArchiveChapterAction(action)) {
        throw new Error(
          withHelpRoute(
            `Invalid chapter action: ${action}. Expected one of list, add, move, remove, reset, set-source, set-summary, set-title, tree. Use concrete chapter resource URIs such as /source, /summary, or /title for set operations.`,
            CLI_HELP_ROUTES.command,
          ),
        );
      }
      if (positionals.length > 1) {
        throw new Error(
          withHelpRoute(
            `Unexpected positional arguments: ${positionals.slice(1).join(" ")}.`,
            CLI_HELP_ROUTES.command,
          ),
        );
      }
      return {
        help: true,
        helpText: renderArchiveMaintenanceChapterActionHelpText(action),
        kind: "chapter",
      };
    }
  }
}

function parseArchiveArguments(
  action: CLIArchiveAction,
  positionals: readonly string[],
  values: ArchiveArgumentValues,
  helpRoute = `wikigraph ${action} --help`,
  options: {
    readonly defaultKinds?: readonly CLIObjectKind[];
    readonly triplePattern?: ArchiveTriplePattern;
  } = {},
): ParsedCLIArguments {
  const normalized = normalizeArchiveInlineOptions(positionals, values);

  positionals = normalized.positionals;
  values = normalized.values;

  const archivePath = positionals[0];

  if (values.help === true) {
    return {
      help: true,
      helpText: renderArchiveCommandHelpText(action),
      kind: "help",
    };
  }

  if (archivePath === undefined || archivePath === "-") {
    throw new Error(
      withHelpRoute(formatMissingArchiveInputMessage(action), helpRoute),
    );
  }

  validateArchiveCommandUriInput(action, archivePath);

  if (values.verbose === true) {
    throw new Error(
      withHelpRoute(
        `The \`${action}\` command does not support --verbose.`,
        helpRoute,
      ),
    );
  }

  switch (action) {
    case "create": {
      const rawSourcePath = positionals[1] ?? values.input;
      const sourcePath = rawSourcePath === "-" ? undefined : rawSourcePath;
      const inputFormat =
        values["input-format"] === undefined
          ? undefined
          : parseCLIFormat(values["input-format"], "--input-format");

      if (
        sourcePath === undefined &&
        inputFormat !== undefined &&
        inputFormat !== "markdown" &&
        inputFormat !== "txt"
      ) {
        throw new Error(
          withHelpRoute(
            "stdin create only supports --input-format markdown or txt.",
            helpRoute,
          ),
        );
      }
      rejectArchiveExtraPositionals(action, positionals, 2, helpRoute);
      rejectArchiveFlag(action, "--output", values.output, helpRoute);
      rejectArchiveFlag(
        action,
        "--output-format",
        values["output-format"],
        helpRoute,
      );
      rejectArchiveFlag(action, "--stage", values.stage, helpRoute);
      rejectArchiveFlag(action, "--to", values.to, helpRoute);
      rejectArchiveFlag(action, "--chapter", values.chapter, helpRoute);
      rejectArchiveFlag(action, "--context", values.context, helpRoute);
      rejectArchiveFlag(action, "--limit", values.limit, helpRoute);
      rejectArchiveFlag(action, "--evidence", values.evidence, helpRoute);
      rejectArchiveFlag(action, "--budget", values.budget, helpRoute);
      rejectArchiveBooleanFlag(action, "--all", values.all, helpRoute);
      rejectArchiveBooleanFlag(
        action,
        "--backlinks",
        values.backlinks,
        helpRoute,
      );
      rejectArchiveFlag(action, "--role", values.role, helpRoute);
      rejectArchiveBooleanFlag(action, "--confirm", values.confirm, helpRoute);
      rejectArchiveBooleanFlag(action, "--json", values.json, helpRoute);
      return {
        args: {
          action,
          archivePath,
          ...(inputFormat === undefined ? {} : { inputFormat }),
          ...(values.llm === undefined ? {} : { llmJSON: values.llm }),
          ...(values.prompt === undefined ? {} : { prompt: values.prompt }),
          ...(sourcePath === undefined ? {} : { sourcePath }),
        },
        help: false,
        kind: "archive",
      };
    }
    case "export":
      rejectArchiveExtraPositionals(action, positionals, 1, helpRoute);
      rejectArchiveFlag(action, "--input", values.input, helpRoute);
      rejectArchiveFlag(
        action,
        "--input-format",
        values["input-format"],
        helpRoute,
      );
      rejectArchiveFlag(action, "--prompt", values.prompt, helpRoute);
      rejectArchiveFlag(action, "--stage", values.stage, helpRoute);
      rejectArchiveFlag(action, "--to", values.to, helpRoute);
      rejectArchiveFlag(action, "--chapter", values.chapter, helpRoute);
      rejectArchiveFlag(action, "--context", values.context, helpRoute);
      rejectArchiveFlag(action, "--limit", values.limit, helpRoute);
      rejectArchiveFlag(action, "--evidence", values.evidence, helpRoute);
      rejectArchiveFlag(action, "--budget", values.budget, helpRoute);
      rejectArchiveBooleanFlag(action, "--all", values.all, helpRoute);
      rejectArchiveBooleanFlag(
        action,
        "--backlinks",
        values.backlinks,
        helpRoute,
      );
      rejectArchiveFlag(action, "--role", values.role, helpRoute);
      rejectArchiveBooleanFlag(action, "--confirm", values.confirm, helpRoute);
      rejectArchiveBooleanFlag(action, "--json", values.json, helpRoute);
      return {
        args: {
          action,
          archivePath,
          ...(values.output === undefined ? {} : { outputPath: values.output }),
          outputFormat:
            values["output-format"] === undefined
              ? parseCLIFormat("markdown", "--output-format")
              : parseCLIFormat(values["output-format"], "--output-format"),
        },
        help: false,
        kind: "archive",
      };
    case "estimate":
      rejectArchiveExtraPositionals(action, positionals, 1, helpRoute);
      rejectArchiveNonReadFlags(action, values, helpRoute);
      rejectArchiveFlag(action, "--budget", values.budget, helpRoute);
      rejectArchiveFlag(action, "--context", values.context, helpRoute);
      rejectArchiveFlag(action, "--to", values.to, helpRoute);
      rejectArchiveFlag(action, "--evidence", values.evidence, helpRoute);
      rejectArchiveBooleanFlag(action, "--all", values.all, helpRoute);
      rejectArchiveBooleanFlag(action, "--confirm", values.confirm, helpRoute);
      return {
        args: {
          action,
          archivePath,
          ...(values.json === undefined ? {} : { json: values.json }),
          targetStage: parseArchiveEstimateStage(values.stage ?? values.to),
        },
        help: false,
        kind: "archive",
      };
    case "search": {
      const query = positionals[1];

      if (query === undefined) {
        throw new Error(
          withHelpRoute(
            "`wikigraph search` requires a search query.",
            helpRoute,
          ),
        );
      }
      rejectArchiveExtraPositionals(action, positionals, 2, helpRoute);
      rejectArchiveNonReadFlags(action, values, helpRoute);
      rejectArchiveFlag(action, "--budget", values.budget, helpRoute);
      rejectArchiveFlag(action, "--chapter", values.chapter, helpRoute);
      rejectArchiveFlag(action, "--from", values.from, helpRoute);
      rejectArchiveFlag(action, "--role", values.role, helpRoute);
      rejectArchiveFlag(action, "--to", values.to, helpRoute);
      rejectArchiveBooleanFlag(action, "--confirm", values.confirm, helpRoute);

      return {
        args: {
          action,
          ...(values.all === undefined ? {} : { all: values.all }),
          archivePath,
          ...(values.backlinks === undefined
            ? {}
            : { backlinks: values.backlinks }),
          ...(values.cursor === undefined ? {} : { cursor: values.cursor }),
          ...parseSourceContextFlag(values.context, helpRoute),
          ...parseEvidenceFlag(values.evidence, helpRoute),
          format: parseResultFormat(values),
          ...(values.limit === undefined
            ? {}
            : {
                limit: parsePositiveIntegerFlag(
                  values.limit,
                  "--limit",
                  helpRoute,
                ),
              }),
          query,
          ...(options.defaultKinds === undefined
            ? {}
            : { kinds: options.defaultKinds }),
          ...(options.triplePattern === undefined
            ? {}
            : { triplePattern: options.triplePattern }),
        },
        help: false,
        kind: "archive",
      };
    }
    case "list": {
      rejectArchiveExtraPositionals(action, positionals, 1, helpRoute);
      rejectArchiveNonReadFlags(action, values, helpRoute);
      rejectArchiveFlag(action, "--budget", values.budget, helpRoute);
      rejectArchiveFlag(action, "--chapter", values.chapter, helpRoute);
      rejectArchiveFlag(action, "--from", values.from, helpRoute);
      rejectArchiveFlag(action, "--role", values.role, helpRoute);
      rejectArchiveFlag(action, "--to", values.to, helpRoute);
      rejectArchiveBooleanFlag(action, "--confirm", values.confirm, helpRoute);
      return {
        args: {
          action,
          ...(values.all === undefined ? {} : { all: values.all }),
          archivePath,
          ...(values.backlinks === undefined
            ? {}
            : { backlinks: values.backlinks }),
          ...(values.cursor === undefined ? {} : { cursor: values.cursor }),
          ...parseSourceContextFlag(values.context, helpRoute),
          ...parseEvidenceFlag(values.evidence, helpRoute),
          format: parseResultFormat(values),
          ...(values.limit === undefined
            ? {}
            : {
                limit: parsePositiveIntegerFlag(
                  values.limit,
                  "--limit",
                  helpRoute,
                ),
              }),
          ...(options.defaultKinds === undefined
            ? {}
            : { kinds: options.defaultKinds }),
          ...(options.triplePattern === undefined
            ? {}
            : { triplePattern: options.triplePattern }),
        },
        help: false,
        kind: "archive",
      };
    }
    case "get": {
      rejectArchiveExtraPositionals(action, positionals, 1, helpRoute);
      rejectArchiveNonReadFlags(action, values, helpRoute);
      rejectArchiveFlag(action, "--budget", values.budget, helpRoute);
      rejectArchiveFlag(action, "--chapter", values.chapter, helpRoute);
      rejectArchiveFlag(action, "--from", values.from, helpRoute);
      rejectArchiveFlag(action, "--limit", values.limit, helpRoute);
      rejectArchiveFlag(action, "--cursor", values.cursor, helpRoute);
      rejectArchiveFlag(action, "--role", values.role, helpRoute);
      rejectArchiveFlag(action, "--to", values.to, helpRoute);
      rejectArchiveBooleanFlag(action, "--all", values.all, helpRoute);
      rejectArchiveBooleanFlag(action, "--confirm", values.confirm, helpRoute);
      return {
        args: {
          action,
          archivePath,
          ...(values.backlinks === undefined
            ? {}
            : { backlinks: values.backlinks }),
          ...parseSourceContextFlag(values.context, helpRoute),
          ...parseEvidenceFlag(values.evidence, helpRoute),
          format: parseResultFormat(values),
          objectId: archivePath,
        },
        help: false,
        kind: "archive",
      };
    }
    case "related": {
      rejectArchiveExtraPositionals(action, positionals, 2, helpRoute);
      rejectArchiveNonReadFlags(action, values, helpRoute);
      rejectArchiveBooleanFlag(
        action,
        "--backlinks",
        values.backlinks,
        helpRoute,
      );
      rejectArchiveFlag(action, "--budget", values.budget, helpRoute);
      rejectArchiveFlag(action, "--chapter", values.chapter, helpRoute);
      rejectArchiveFlag(action, "--from", values.from, helpRoute);
      const relatedTarget = validateRelatedTargetUri(archivePath, helpRoute);
      if (relatedTarget === "chunk") {
        rejectArchiveFlag(action, "--role", values.role, helpRoute);
      }
      rejectArchiveFlag(action, "--to", values.to, helpRoute);
      rejectArchiveBooleanFlag(action, "--confirm", values.confirm, helpRoute);
      return {
        args: {
          action,
          ...(values.all === undefined ? {} : { all: values.all }),
          archivePath,
          ...(values.cursor === undefined ? {} : { cursor: values.cursor }),
          ...parseSourceContextFlag(values.context, helpRoute),
          ...parseEvidenceFlag(values.evidence, helpRoute),
          format: parseResultFormat(values),
          ...(values.limit === undefined
            ? {}
            : {
                limit: parsePositiveIntegerFlag(
                  values.limit,
                  "--limit",
                  helpRoute,
                ),
              }),
          objectId: archivePath,
          ...(positionals[1] === undefined ? {} : { query: positionals[1] }),
          ...(relatedTarget === "entity"
            ? parseRelatedRoleFlag(values.role, helpRoute)
            : {}),
        },
        help: false,
        kind: "archive",
      };
    }
    case "evidence": {
      rejectArchiveExtraPositionals(action, positionals, 2, helpRoute);
      rejectArchiveNonReadFlags(action, values, helpRoute);
      rejectArchiveBooleanFlag(
        action,
        "--backlinks",
        values.backlinks,
        helpRoute,
      );
      rejectArchiveFlag(action, "--budget", values.budget, helpRoute);
      rejectArchiveFlag(action, "--chapter", values.chapter, helpRoute);
      rejectArchiveFlag(action, "--from", values.from, helpRoute);
      rejectArchiveFlag(action, "--role", values.role, helpRoute);
      rejectArchiveFlag(action, "--to", values.to, helpRoute);
      rejectArchiveFlag(action, "--evidence", values.evidence, helpRoute);
      rejectArchiveBooleanFlag(action, "--confirm", values.confirm, helpRoute);
      return {
        args: {
          action,
          ...(values.all === undefined ? {} : { all: values.all }),
          archivePath,
          ...(values.cursor === undefined ? {} : { cursor: values.cursor }),
          ...parseSourceContextFlag(values.context, helpRoute),
          format: parseResultFormat(values),
          ...(values.limit === undefined
            ? {}
            : {
                limit: parsePositiveIntegerFlag(
                  values.limit,
                  "--limit",
                  helpRoute,
                ),
              }),
          objectId: archivePath,
          ...(positionals[1] === undefined ? {} : { query: positionals[1] }),
        },
        help: false,
        kind: "archive",
      };
    }
    case "pack": {
      rejectArchiveExtraPositionals(action, positionals, 1, helpRoute);
      rejectArchiveNonReadFlags(action, values, helpRoute);
      rejectArchiveBooleanFlag(
        action,
        "--backlinks",
        values.backlinks,
        helpRoute,
      );
      rejectArchiveFlag(action, "--chapter", values.chapter, helpRoute);
      rejectArchiveFlag(action, "--context", values.context, helpRoute);
      rejectArchiveFlag(action, "--from", values.from, helpRoute);
      rejectArchiveFlag(action, "--limit", values.limit, helpRoute);
      rejectArchiveFlag(action, "--cursor", values.cursor, helpRoute);
      rejectArchiveFlag(action, "--evidence", values.evidence, helpRoute);
      rejectArchiveFlag(action, "--role", values.role, helpRoute);
      rejectArchiveFlag(action, "--to", values.to, helpRoute);
      rejectArchiveBooleanFlag(action, "--all", values.all, helpRoute);
      validatePackTargetUri(archivePath, helpRoute);
      return {
        args: {
          action,
          archivePath,
          budget:
            values.budget === undefined
              ? 5000
              : parsePositiveIntegerFlag(values.budget, "--budget", helpRoute),
          format: parseResultFormat(values),
          objectId: archivePath,
        },
        help: false,
        kind: "archive",
      };
    }
    case "next": {
      rejectArchiveExtraPositionals(action, positionals, 2, helpRoute);
      rejectArchiveNonReadFlags(action, values, helpRoute);
      rejectArchiveFlag(action, "--budget", values.budget, helpRoute);
      rejectArchiveFlag(action, "--chapter", values.chapter, helpRoute);
      rejectArchiveFlag(action, "--context", values.context, helpRoute);
      rejectArchiveFlag(action, "--cursor", values.cursor, helpRoute);
      rejectArchiveFlag(action, "--evidence", values.evidence, helpRoute);
      rejectArchiveFlag(action, "--from", values.from, helpRoute);
      rejectArchiveFlag(action, "--to", values.to, helpRoute);
      rejectArchiveBooleanFlag(action, "--all", values.all, helpRoute);
      rejectArchiveBooleanFlag(action, "--confirm", values.confirm, helpRoute);

      return {
        args: {
          action,
          archivePath,
          ...(positionals[1] === undefined ? {} : { cursor: positionals[1] }),
          format: parseResultFormat(values),
          ...(values.limit === undefined
            ? {}
            : {
                limit: parsePositiveIntegerFlag(
                  values.limit,
                  "--limit",
                  helpRoute,
                ),
              }),
        },
        help: false,
        kind: "archive",
      };
    }
  }
}

function validateArchiveCommandUriInput(
  action: CLIArchiveAction,
  value: string,
): void {
  if (
    action === "create" ||
    action === "estimate" ||
    action === "export" ||
    action === "next"
  ) {
    return;
  }

  if (isWikiGraphUri(value)) {
    if (parseLocatedWikiGraphUri(value).archivePath === undefined) {
      throw new Error(formatMissingArchiveLocatorMessage(value));
    }
    return;
  }

  if (looksLikeSdpubPath(value)) {
    throw new Error(formatLegacySdpubPathMessage());
  }
  if (!looksLikeWikgPath(value)) {
    return;
  }

  throw new Error(formatPathAsUriMessage(value));
}

function validatePackTargetUri(uri: string, helpRoute: string): void {
  const parsed = parseLocatedWikiGraphUri(uri);

  if (parsed.archivePath === undefined) {
    throw new Error(
      withHelpRoute(formatMissingArchiveLocatorMessage(uri), helpRoute),
    );
  }
  if (parsed.objectUri === undefined) {
    throw new Error(
      withHelpRoute(
        formatPackObjectMismatchMessage(uri),
        "wikigraph help object",
      ),
    );
  }
  if (!isPackableObjectUri(parsed.objectUri)) {
    throw new Error(
      withHelpRoute(formatPackObjectMismatchMessage(uri), helpRoute),
    );
  }
}

function validateRelatedTargetUri(
  uri: string,
  helpRoute: string,
): "chunk" | "entity" {
  const parsed = parseLocatedWikiGraphUri(uri);

  if (parsed.archivePath === undefined) {
    throw new Error(
      withHelpRoute(formatMissingArchiveLocatorMessage(uri), helpRoute),
    );
  }
  if (parsed.objectUri === undefined) {
    throw new Error(
      withHelpRoute(
        `Related requires a chunk or entity URI: ${uri}`,
        "wikigraph help object",
      ),
    );
  }
  const targetType = getRelatedObjectUriType(parsed.objectUri);

  if (targetType === undefined) {
    throw new Error(
      withHelpRoute(
        `Related is only available for chunk and entity objects: ${uri}`,
        helpRoute,
      ),
    );
  }

  return targetType;
}

function isPackableObjectUri(objectUri: string): boolean {
  return (
    /^wkg:\/\/chunk\/[1-9][0-9]*$/u.test(objectUri) ||
    /^wkg:\/\/chapter\/[1-9][0-9]*\/chunk\/[1-9][0-9]*$/u.test(objectUri) ||
    /^wkg:\/\/entity\/[^/]+$/u.test(objectUri) ||
    /^wkg:\/\/chapter\/[1-9][0-9]*\/entity\/[^/]+$/u.test(objectUri)
  );
}

function getRelatedObjectUriType(
  objectUri: string,
): "chunk" | "entity" | undefined {
  if (
    /^wkg:\/\/chunk\/[1-9][0-9]*$/u.test(objectUri) ||
    /^wkg:\/\/chapter\/[1-9][0-9]*\/chunk\/[1-9][0-9]*$/u.test(objectUri)
  ) {
    return "chunk";
  }
  if (
    /^wkg:\/\/entity\/[^/]+$/u.test(objectUri) ||
    /^wkg:\/\/chapter\/[1-9][0-9]*\/entity\/[^/]+$/u.test(objectUri)
  ) {
    return "entity";
  }

  return undefined;
}

function formatUnknownCommandMessage(command: string): string {
  if (looksLikeSdpubPath(command)) {
    return formatLegacySdpubPathMessage();
  }
  if (looksLikeWikgPath(command)) {
    return formatPathAsUriMessage(command);
  }

  return withHelpRoute(`Unknown command: ${command}.`, CLI_HELP_ROUTES.command);
}

function formatLegacySdpubPathMessage(): string {
  return withHelpRoute(
    "Legacy .sdpub archives must be migrated first.",
    "wikigraph legacy migrate --help",
  );
}

function looksLikeSdpubPath(value: string): boolean {
  const normalized = normalizeWikgPathSeparators(value);

  return (
    normalized.endsWith(".sdpub") ||
    normalized.includes(".sdpub/") ||
    normalized.includes(".sdpub#")
  );
}

function looksLikeWikgPath(value: string): boolean {
  const normalized = normalizeWikgPathSeparators(value);

  return (
    normalized.endsWith(".wikg") ||
    normalized.includes(".wikg/") ||
    normalized.includes(".wikg#")
  );
}

function formatPathAsUriMessage(path: string): string {
  const normalized = normalizeWikgPathSeparators(path);
  const [archivePath = normalized, suffix = ""] = splitWikgPath(normalized);
  const uri = archivePath.startsWith("/")
    ? `wkg://${archivePath}${suffix}`
    : `wkg://${archivePath.replace(/^\.\/+/u, "")}${suffix}`;

  return [
    `Expected a Wiki Graph URI, not a filesystem path: ${path}`,
    `Use: ${uri}`,
    "See: wikigraph help uri",
  ].join("\n");
}

function splitWikgPath(path: string): readonly [string, string] {
  const archiveEnd = path.indexOf(".wikg") + ".wikg".length;

  return [path.slice(0, archiveEnd), path.slice(archiveEnd)];
}

function normalizeWikgPathSeparators(path: string): string {
  return path.replace(/\\/gu, "/");
}

function formatMissingArchiveLocatorMessage(uri: string): string {
  return [
    `Expected a located Wiki Graph URI with a .wikg archive locator: ${uri}`,
    "Short object URIs from output are archive-relative handles.",
    "Example: wkg://book.wikg/entity/Q9957",
    "See: wikigraph help uri",
  ].join("\n");
}

function formatPackObjectMismatchMessage(uri: string): string {
  return [
    `Pack requires a graph object URI: ${uri}`,
    "Supported pack targets are chunk and entity objects.",
    "Use `wikigraph help object` to inspect valid object/verb pairs.",
  ].join("\n");
}

function formatMissingArchiveInputMessage(action: CLIArchiveAction): string {
  switch (action) {
    case "create":
      return "Missing archive URI. Use `wikigraph wkg://<archive.wikg> create [source]`.";
    case "export":
      return "Missing archive URI. Use `wikigraph wkg://<archive.wikg> export --output-format <format>`.";
    case "estimate":
      return "Missing archive URI. Use `wikigraph wkg://<archive.wikg> estimate`.";
    case "search":
      return "Missing Wiki Graph URI with .wikg locator. Use `wikigraph wkg://<archive.wikg> search <query>`.";
    case "list":
      return "Missing Wiki Graph URI with .wikg locator. Use `wikigraph wkg://<archive.wikg> list`.";
    case "get":
    case "related":
    case "evidence":
    case "pack":
      return `Missing object URI. Use \`wikigraph wkg://<archive.wikg>/<object> ${action}\`.`;
    case "next":
      return "Missing continuation cursor. Use `wikigraph next <cursor>`.";
  }
}

function normalizeArchiveChapterArguments(
  action: CLIArchiveChapterAction,
  path: string,
  values: {
    readonly chapter?: string;
    readonly after?: string;
    readonly before?: string;
    readonly clear?: boolean;
    readonly "dry-run"?: boolean;
    readonly first?: boolean;
    readonly input?: string;
    readonly "input-format"?: string;
    readonly json?: boolean;
    readonly llm?: string;
    readonly parent?: string;
    readonly prompt?: string;
    readonly recursive?: boolean;
    readonly root?: boolean;
    readonly last?: boolean;
    readonly stage?: string;
    readonly title?: string;
    readonly to?: string;
  },
  helpRoute: string,
  treeAction?: "apply",
): CLIArchiveChapterArguments {
  const chapterId =
    values.chapter === undefined
      ? undefined
      : parseSerialId(values.chapter, "--chapter", helpRoute);
  const parentChapterId =
    values.parent === undefined
      ? undefined
      : parseChapterRef(values.parent, "--parent", path, helpRoute);
  const beforeChapterId =
    values.before === undefined
      ? undefined
      : parseChapterRef(values.before, "--before", path, helpRoute);
  const afterChapterId =
    values.after === undefined
      ? undefined
      : parseChapterRef(values.after, "--after", path, helpRoute);
  const inputFormat =
    values["input-format"] === undefined
      ? undefined
      : parseChapterInputFormat(values["input-format"], helpRoute);
  const addStage =
    values.stage === undefined
      ? undefined
      : parseChapterAddStage(values.stage, helpRoute);
  const resetStage =
    values.to === undefined ? undefined : parseResetStage(values.to, helpRoute);

  switch (action) {
    case "set":
      throw new Error(
        withHelpRoute(
          "`set` requires a concrete chapter sub-resource URI such as `/source`, `/summary`, or `/title`.",
          helpRoute,
        ),
      );
    case "add":
      rejectActionFlag(values.chapter, "--chapter", action, helpRoute);
      rejectActionFlag(values.prompt, "--prompt", action, helpRoute);
      rejectActionFlag(values.to, "--to", action, helpRoute);
      rejectActionBooleanFlag(
        values.recursive,
        "--recursive",
        action,
        helpRoute,
      );
      if (addStage === undefined) {
        throw new Error(
          withHelpRoute(
            "Missing --stage. `chapter add` requires planned or source.",
            helpRoute,
          ),
        );
      }
      if (addStage === "planned") {
        rejectActionFlag(values.input, "--input", action, helpRoute);
        rejectActionFlag(
          values["input-format"],
          "--input-format",
          action,
          helpRoute,
        );
      } else if (addStage === "sourced" && inputFormat === undefined) {
        throw new Error(
          withHelpRoute(
            "Missing --input-format. `chapter add --stage source` requires txt or markdown.",
            helpRoute,
          ),
        );
      }
      return {
        action,
        path,
        ...(addStage === undefined ? {} : { addStage }),
        ...(inputFormat === undefined ? {} : { inputFormat }),
        ...(values.input === undefined ? {} : { inputPath: values.input }),
        ...(values.llm === undefined ? {} : { llmJSON: values.llm }),
        ...(parentChapterId === undefined ? {} : { parentChapterId }),
        ...(values.title === undefined ? {} : { title: values.title }),
      };
    case "list":
      rejectActionFlag(values.stage, "--stage", action, helpRoute);
      rejectActionFlag(values.chapter, "--chapter", action, helpRoute);
      rejectActionFlag(values.after, "--after", action, helpRoute);
      rejectActionFlag(values.before, "--before", action, helpRoute);
      rejectActionFlag(values.input, "--input", action, helpRoute);
      rejectActionFlag(
        values["input-format"],
        "--input-format",
        action,
        helpRoute,
      );
      rejectActionFlag(values.parent, "--parent", action, helpRoute);
      rejectActionFlag(values.prompt, "--prompt", action, helpRoute);
      rejectActionFlag(values.title, "--title", action, helpRoute);
      rejectActionFlag(values.to, "--to", action, helpRoute);
      rejectActionBooleanFlag(values.clear, "--clear", action, helpRoute);
      rejectActionBooleanFlag(
        values["dry-run"],
        "--dry-run",
        action,
        helpRoute,
      );
      rejectActionBooleanFlag(values.first, "--first", action, helpRoute);
      rejectActionBooleanFlag(values.root, "--root", action, helpRoute);
      rejectActionBooleanFlag(values.last, "--last", action, helpRoute);
      rejectActionBooleanFlag(
        values.recursive,
        "--recursive",
        action,
        helpRoute,
      );
      return {
        action,
        ...(values.json === undefined ? {} : { json: values.json }),
        path,
        ...(values.llm === undefined ? {} : { llmJSON: values.llm }),
      };
    case "move":
      requireChapterId(chapterId, action, helpRoute);
      rejectActionFlag(values.stage, "--stage", action, helpRoute);
      rejectActionFlag(values.input, "--input", action, helpRoute);
      rejectActionFlag(
        values["input-format"],
        "--input-format",
        action,
        helpRoute,
      );
      rejectActionFlag(values.prompt, "--prompt", action, helpRoute);
      rejectActionFlag(values.title, "--title", action, helpRoute);
      rejectActionFlag(values.to, "--to", action, helpRoute);
      rejectActionBooleanFlag(values.clear, "--clear", action, helpRoute);
      rejectActionBooleanFlag(
        values["dry-run"],
        "--dry-run",
        action,
        helpRoute,
      );
      rejectActionBooleanFlag(
        values.recursive,
        "--recursive",
        action,
        helpRoute,
      );
      rejectConflictingMoveFlags(values, helpRoute);
      return {
        action,
        ...(afterChapterId === undefined ? {} : { afterChapterId }),
        ...(beforeChapterId === undefined ? {} : { beforeChapterId }),
        chapterId,
        ...(values.first === undefined ? {} : { first: values.first }),
        ...(values.last === undefined ? {} : { last: values.last }),
        ...(values.llm === undefined ? {} : { llmJSON: values.llm }),
        ...(values.root === undefined ? {} : { moveToRoot: values.root }),
        ...(parentChapterId === undefined ? {} : { parentChapterId }),
        path,
      };
    case "remove":
      requireChapterId(chapterId, action, helpRoute);
      rejectActionFlag(values.stage, "--stage", action, helpRoute);
      rejectActionFlag(values.after, "--after", action, helpRoute);
      rejectActionFlag(values.before, "--before", action, helpRoute);
      rejectActionFlag(values.input, "--input", action, helpRoute);
      rejectActionFlag(
        values["input-format"],
        "--input-format",
        action,
        helpRoute,
      );
      rejectActionFlag(values.parent, "--parent", action, helpRoute);
      rejectActionFlag(values.prompt, "--prompt", action, helpRoute);
      rejectActionFlag(values.title, "--title", action, helpRoute);
      rejectActionFlag(values.to, "--to", action, helpRoute);
      rejectActionBooleanFlag(values.clear, "--clear", action, helpRoute);
      rejectActionBooleanFlag(
        values["dry-run"],
        "--dry-run",
        action,
        helpRoute,
      );
      rejectActionBooleanFlag(values.first, "--first", action, helpRoute);
      rejectActionBooleanFlag(values.root, "--root", action, helpRoute);
      rejectActionBooleanFlag(values.last, "--last", action, helpRoute);
      return {
        action,
        chapterId,
        path,
        ...(values.llm === undefined ? {} : { llmJSON: values.llm }),
        ...(values.recursive === undefined
          ? {}
          : { recursive: values.recursive }),
      };
    case "reset":
      requireChapterId(chapterId, action, helpRoute);
      rejectActionFlag(values.stage, "--stage", action, helpRoute);
      rejectActionFlag(values.after, "--after", action, helpRoute);
      rejectActionFlag(values.before, "--before", action, helpRoute);
      if (resetStage === undefined) {
        throw new Error(
          withHelpRoute(
            "Missing --to. `chapter reset` requires planned, source, or reading-graph.",
            helpRoute,
          ),
        );
      }
      rejectActionFlag(values.input, "--input", action, helpRoute);
      rejectActionFlag(
        values["input-format"],
        "--input-format",
        action,
        helpRoute,
      );
      rejectActionFlag(values.parent, "--parent", action, helpRoute);
      rejectActionFlag(values.prompt, "--prompt", action, helpRoute);
      rejectActionFlag(values.title, "--title", action, helpRoute);
      rejectActionBooleanFlag(values.clear, "--clear", action, helpRoute);
      rejectActionBooleanFlag(
        values["dry-run"],
        "--dry-run",
        action,
        helpRoute,
      );
      rejectActionBooleanFlag(values.first, "--first", action, helpRoute);
      rejectActionBooleanFlag(values.root, "--root", action, helpRoute);
      rejectActionBooleanFlag(values.last, "--last", action, helpRoute);
      rejectActionBooleanFlag(
        values.recursive,
        "--recursive",
        action,
        helpRoute,
      );
      return {
        action,
        chapterId,
        path,
        resetStage,
        ...(values.llm === undefined ? {} : { llmJSON: values.llm }),
      };
    case "set-source":
      requireChapterId(chapterId, action, helpRoute);
      rejectActionFlag(values.stage, "--stage", action, helpRoute);
      rejectActionFlag(values.after, "--after", action, helpRoute);
      rejectActionFlag(values.before, "--before", action, helpRoute);
      if (inputFormat === undefined) {
        throw new Error(
          withHelpRoute(
            "Missing --input-format. `chapter set-source` requires txt or markdown.",
            helpRoute,
          ),
        );
      }
      rejectActionFlag(values.parent, "--parent", action, helpRoute);
      rejectActionFlag(values.prompt, "--prompt", action, helpRoute);
      rejectActionFlag(values.title, "--title", action, helpRoute);
      rejectActionFlag(values.to, "--to", action, helpRoute);
      rejectActionBooleanFlag(values.clear, "--clear", action, helpRoute);
      rejectActionBooleanFlag(
        values["dry-run"],
        "--dry-run",
        action,
        helpRoute,
      );
      rejectActionBooleanFlag(values.first, "--first", action, helpRoute);
      rejectActionBooleanFlag(values.root, "--root", action, helpRoute);
      rejectActionBooleanFlag(values.last, "--last", action, helpRoute);
      rejectActionBooleanFlag(
        values.recursive,
        "--recursive",
        action,
        helpRoute,
      );
      return {
        action,
        chapterId,
        inputFormat,
        path,
        ...(values.input === undefined ? {} : { inputPath: values.input }),
        ...(values.llm === undefined ? {} : { llmJSON: values.llm }),
      };
    case "set-summary":
      requireChapterId(chapterId, action, helpRoute);
      rejectActionFlag(values.stage, "--stage", action, helpRoute);
      rejectActionFlag(values.after, "--after", action, helpRoute);
      rejectActionFlag(values.before, "--before", action, helpRoute);
      rejectActionFlag(
        values["input-format"],
        "--input-format",
        action,
        helpRoute,
      );
      rejectActionFlag(values.parent, "--parent", action, helpRoute);
      rejectActionFlag(values.prompt, "--prompt", action, helpRoute);
      rejectActionFlag(values.title, "--title", action, helpRoute);
      rejectActionFlag(values.to, "--to", action, helpRoute);
      rejectActionBooleanFlag(values.clear, "--clear", action, helpRoute);
      rejectActionBooleanFlag(
        values["dry-run"],
        "--dry-run",
        action,
        helpRoute,
      );
      rejectActionBooleanFlag(values.first, "--first", action, helpRoute);
      rejectActionBooleanFlag(values.root, "--root", action, helpRoute);
      rejectActionBooleanFlag(values.last, "--last", action, helpRoute);
      rejectActionBooleanFlag(
        values.recursive,
        "--recursive",
        action,
        helpRoute,
      );
      return {
        action,
        chapterId,
        path,
        ...(values.input === undefined ? {} : { inputPath: values.input }),
        ...(values.llm === undefined ? {} : { llmJSON: values.llm }),
      };
    case "set-title":
      requireChapterId(chapterId, action, helpRoute);
      rejectActionFlag(values.stage, "--stage", action, helpRoute);
      rejectActionFlag(values.after, "--after", action, helpRoute);
      rejectActionFlag(values.before, "--before", action, helpRoute);
      if (values.title === undefined && values.clear !== true) {
        throw new Error(
          withHelpRoute(
            "Missing --title or --clear. `chapter set-title` requires a title value or --clear.",
            helpRoute,
          ),
        );
      }
      if (values.title !== undefined && values.clear === true) {
        throw new Error(
          withHelpRoute(
            "`chapter set-title` cannot combine --title with --clear.",
            helpRoute,
          ),
        );
      }
      rejectActionFlag(values.input, "--input", action, helpRoute);
      rejectActionFlag(
        values["input-format"],
        "--input-format",
        action,
        helpRoute,
      );
      rejectActionFlag(values.parent, "--parent", action, helpRoute);
      rejectActionFlag(values.prompt, "--prompt", action, helpRoute);
      rejectActionFlag(values.to, "--to", action, helpRoute);
      rejectActionBooleanFlag(
        values["dry-run"],
        "--dry-run",
        action,
        helpRoute,
      );
      rejectActionBooleanFlag(values.first, "--first", action, helpRoute);
      rejectActionBooleanFlag(values.root, "--root", action, helpRoute);
      rejectActionBooleanFlag(values.last, "--last", action, helpRoute);
      rejectActionBooleanFlag(
        values.recursive,
        "--recursive",
        action,
        helpRoute,
      );
      return {
        action,
        chapterId,
        ...(values.clear === undefined ? {} : { clearTitle: values.clear }),
        path,
        ...(values.title === undefined ? {} : { title: values.title }),
        ...(values.llm === undefined ? {} : { llmJSON: values.llm }),
      };
    case "tree":
      rejectActionFlag(values.stage, "--stage", action, helpRoute);
      rejectActionFlag(values.chapter, "--chapter", action, helpRoute);
      rejectActionFlag(values.after, "--after", action, helpRoute);
      rejectActionFlag(values.before, "--before", action, helpRoute);
      rejectActionFlag(
        values["input-format"],
        "--input-format",
        action,
        helpRoute,
      );
      rejectActionFlag(values.parent, "--parent", action, helpRoute);
      rejectActionFlag(values.prompt, "--prompt", action, helpRoute);
      rejectActionFlag(values.title, "--title", action, helpRoute);
      rejectActionFlag(values.to, "--to", action, helpRoute);
      rejectActionBooleanFlag(values.clear, "--clear", action, helpRoute);
      rejectActionBooleanFlag(values.first, "--first", action, helpRoute);
      rejectActionBooleanFlag(values.root, "--root", action, helpRoute);
      rejectActionBooleanFlag(values.last, "--last", action, helpRoute);
      rejectActionBooleanFlag(
        values.recursive,
        "--recursive",
        action,
        helpRoute,
      );
      if (treeAction === "apply" && values.json === true) {
        throw new Error(
          withHelpRoute(
            "`chapter tree apply` does not support --json.",
            helpRoute,
          ),
        );
      }
      if (treeAction === "apply") {
        return {
          action,
          ...(values["dry-run"] === undefined
            ? {}
            : { dryRun: values["dry-run"] }),
          ...(values.input === undefined ? {} : { inputPath: values.input }),
          ...(values.llm === undefined ? {} : { llmJSON: values.llm }),
          path,
          treeAction: "apply",
        };
      }
      rejectActionFlag(values.input, "--input", action, helpRoute);
      rejectActionBooleanFlag(
        values["dry-run"],
        "--dry-run",
        action,
        helpRoute,
      );
      return {
        action,
        json: values.json ?? false,
        ...(values.llm === undefined ? {} : { llmJSON: values.llm }),
        path,
        treeAction: "show",
      };
  }
}

function parseHelpArguments(
  positionals: readonly string[],
  values: {
    readonly author?: readonly string[];
    readonly "clear-authors"?: boolean;
    readonly "clear-description"?: boolean;
    readonly "clear-identifier"?: boolean;
    readonly "clear-language"?: boolean;
    readonly "clear-published-at"?: boolean;
    readonly "clear-publisher"?: boolean;
    readonly "clear-title"?: boolean;
    readonly description?: string;
    readonly "digest-dir"?: string;
    readonly help?: boolean;
    readonly identifier?: string;
    readonly input?: string;
    readonly "input-format"?: string;
    readonly json?: boolean;
    readonly language?: string;
    readonly limit?: string;
    readonly llm?: string;
    readonly output?: string;
    readonly "output-format"?: string;
    readonly "published-at"?: string;
    readonly publisher?: string;
    readonly prompt?: string;
    readonly stage?: string;
    readonly verbose?: boolean;
  },
): ParsedCLIArguments {
  rejectHelpFlag("digest-dir", values["digest-dir"]);
  rejectHelpFlag("input", values.input);
  rejectHelpFlag("input-format", values["input-format"]);
  rejectHelpFlag("json", values.json);
  rejectHelpFlag("limit", values.limit);
  rejectHelpFlag("llm", values.llm);
  rejectHelpFlag("output", values.output);
  rejectHelpFlag("output-format", values["output-format"]);
  rejectHelpFlag("prompt", values.prompt);
  rejectHelpFlag("stage", values.stage);
  rejectHelpMetaFlags(values);

  if (values.verbose) {
    throw new Error(
      withHelpRoute(
        "The `help` command does not support --verbose.",
        CLI_HELP_ROUTES.root,
      ),
    );
  }

  if (
    positionals.length > 1 &&
    positionals[0] !== "object" &&
    positionals[0] !== "verb"
  ) {
    throw new Error(
      withHelpRoute(
        `Unexpected positional arguments: ${positionals.slice(1).join(" ")}.`,
        CLI_HELP_ROUTES.root,
      ),
    );
  }

  if (positionals[0] === undefined) {
    return {
      help: true,
      helpText: renderMainHelpText(),
      kind: "help",
    };
  }

  const matrixPage = parseHelpMatrixPage(positionals);
  if (matrixPage !== undefined) {
    return {
      help: true,
      helpText: renderHelpMatrixText(matrixPage),
      kind: "help",
    };
  }

  if (isArchiveAction(positionals[0])) {
    return {
      help: true,
      helpText: renderArchiveCommandHelpText(positionals[0]),
      kind: "help",
    };
  }

  return {
    help: true,
    helpText: renderHelpTopicText(parseHelpTopic(positionals[0])),
    kind: "help",
  };
}

function parseConfigStatusArguments(
  positionals: readonly string[],
  values: {
    readonly author?: readonly string[];
    readonly "clear-authors"?: boolean;
    readonly "clear-description"?: boolean;
    readonly "clear-identifier"?: boolean;
    readonly "clear-language"?: boolean;
    readonly "clear-published-at"?: boolean;
    readonly "clear-publisher"?: boolean;
    readonly "clear-title"?: boolean;
    readonly description?: string;
    readonly "digest-dir"?: string;
    readonly help?: boolean;
    readonly identifier?: string;
    readonly input?: string;
    readonly "input-format"?: string;
    readonly json?: boolean;
    readonly language?: string;
    readonly limit?: string;
    readonly llm?: string;
    readonly output?: string;
    readonly "output-format"?: string;
    readonly "published-at"?: string;
    readonly publisher?: string;
    readonly prompt?: string;
    readonly stage?: string;
    readonly verbose?: boolean;
  },
): ParsedCLIArguments {
  rejectStatusFlag("digest-dir", values["digest-dir"]);
  rejectStatusFlag("input", values.input);
  rejectStatusFlag("input-format", values["input-format"]);
  rejectStatusFlag("json", values.json);
  rejectStatusFlag("limit", values.limit);
  rejectStatusFlag("output", values.output);
  rejectStatusFlag("output-format", values["output-format"]);
  rejectStatusFlag("prompt", values.prompt);
  rejectStatusFlag("stage", values.stage);
  rejectStatusMetaFlags(values);

  if (values.verbose) {
    throw new Error(
      withHelpRoute(
        "The `config status` command does not support --verbose.",
        "wikigraph config status --help",
      ),
    );
  }

  if (positionals.length > 0) {
    throw new Error(
      withHelpRoute(
        `Unexpected positional arguments: ${positionals.join(" ")}.`,
        "wikigraph config status --help",
      ),
    );
  }

  const args = {
    ...(values.llm === undefined ? {} : { llmJSON: values.llm }),
  } satisfies CLIStatusArguments;

  if (values.help ?? false) {
    return {
      args,
      help: true,
      helpText: renderStatusHelpText(),
      kind: "config-status",
    };
  }

  return {
    args,
    help: false,
    kind: "config-status",
  };
}

function parseSerialId(value: string, flag: string, helpRoute: string): number {
  const normalized = value.trim();

  if (!/^\d+$/u.test(normalized)) {
    throw new Error(
      withHelpRoute(
        `Invalid ${flag}: ${value}. Expected a non-negative integer.`,
        helpRoute,
      ),
    );
  }

  return Number(normalized);
}

function parseChapterRef(
  value: string,
  flag: string,
  archivePath: string,
  helpRoute: string,
): number {
  const normalized = value.trim();

  if (!normalized.startsWith("wkg://")) {
    return parseSerialId(value, flag, helpRoute);
  }

  const parsed = parseLocatedWikiGraphUri(normalized);

  if (parsed.archivePath !== undefined && parsed.archivePath !== archivePath) {
    throw new Error(
      withHelpRoute(
        `Invalid ${flag}: ${value}. Chapter URI belongs to a different archive.`,
        helpRoute,
      ),
    );
  }

  const objectUri = parsed.objectUri ?? normalized;
  const match = /^wkg:\/\/chapter\/([1-9][0-9]*)\/?$/u.exec(objectUri);

  if (match?.[1] === undefined) {
    throw new Error(
      withHelpRoute(
        `Invalid ${flag}: ${value}. Expected a chapter URI such as wkg://chapter/3.`,
        helpRoute,
      ),
    );
  }

  return Number(match[1]);
}

function isArchiveChapterAction(
  value: string | undefined,
): value is CLIArchiveChapterAction {
  return (
    value === "add" ||
    value === "list" ||
    value === "move" ||
    value === "remove" ||
    value === "reset" ||
    value === "set-source" ||
    value === "set-summary" ||
    value === "set-title" ||
    value === "tree"
  );
}

function isArchiveMaintenanceCommand(
  value: string | undefined,
): value is CLIArchiveMaintenanceCommand {
  return value === "chapter" || value === "cover" || value === "meta";
}

function parseChapterStage(
  value: string,
  flag: string,
  helpRoute: string,
): ChapterStage {
  const stage = parseExternalChapterStage(value);

  if (stage !== undefined) {
    return stage;
  }

  throw new Error(
    withHelpRoute(
      `Invalid ${flag}: ${value}. Expected planned, source, reading-graph, or reading-summary.`,
      helpRoute,
    ),
  );
}

function parseChapterInputFormat(
  value: string,
  helpRoute: string,
): Extract<CLIFormat, "markdown" | "txt"> {
  const format = parseCLIFormat(value, "--input-format");

  if (format === "markdown" || format === "txt") {
    return format;
  }

  throw new Error(
    withHelpRoute(
      `Invalid --input-format for chapter source: ${value}. Expected txt or markdown.`,
      helpRoute,
    ),
  );
}

function parseChapterAddStage(
  value: string,
  helpRoute: string,
): Extract<ChapterStage, "planned" | "sourced"> {
  const stage = parseExternalChapterStage(value);

  if (stage === "planned" || stage === "sourced") {
    return stage;
  }

  throw new Error(
    withHelpRoute(
      `Invalid --stage: ${value}. chapter add accepts planned or source.`,
      helpRoute,
    ),
  );
}

function parseResetStage(
  value: string,
  helpRoute: string,
): Exclude<ChapterStage, "summarized"> {
  const stage = parseExternalChapterStage(value);

  if (stage === "planned" || stage === "sourced" || stage === "graphed") {
    return stage;
  }
  if (stage !== undefined) {
    throw new Error(
      withHelpRoute(
        "`chapter reset` does not support --to reading-summary.",
        helpRoute,
      ),
    );
  }

  throw new Error(
    withHelpRoute(
      `Invalid --to: ${value}. Expected planned, source, or reading-graph.`,
      helpRoute,
    ),
  );
}

function parseExternalChapterStage(value: string): ChapterStage | undefined {
  switch (value.trim().toLowerCase()) {
    case "planned":
      return "planned";
    case "source":
      return "sourced";
    case "reading-graph":
      return "graphed";
    case "reading-summary":
      return "summarized";
    default:
      return undefined;
  }
}

function parseArchiveMetaPatch(
  values: ArchiveMetaFlagValues,
  command: "meta",
): ArchiveMetaPatch | undefined {
  const helpRoute = archiveMaintenanceHelpRoute(command);
  const patch = {
    ...parseArchiveStringMetaPatch(values, "title", "title", helpRoute),
    ...parseArchiveStringMetaPatch(values, "language", "language", helpRoute),
    ...parseArchiveStringMetaPatch(
      values,
      "identifier",
      "identifier",
      helpRoute,
    ),
    ...parseArchiveStringMetaPatch(values, "publisher", "publisher", helpRoute),
    ...parseArchiveStringMetaPatch(
      values,
      "publishedAt",
      "published-at",
      helpRoute,
    ),
    ...parseArchiveStringMetaPatch(
      values,
      "description",
      "description",
      helpRoute,
    ),
    ...parseArchiveAuthorsMetaPatch(values, helpRoute),
  } satisfies ArchiveMetaPatch;

  if (Object.keys(patch).length === 0) {
    return undefined;
  }
  return patch;
}

function parseArchiveStringMetaPatch(
  values: ArchiveMetaFlagValues,
  key:
    | "description"
    | "identifier"
    | "language"
    | "publishedAt"
    | "publisher"
    | "title",
  flag:
    | "description"
    | "identifier"
    | "language"
    | "published-at"
    | "publisher"
    | "title",
  helpRoute: string,
): Partial<ArchiveMetaPatch> {
  const value = values[flag];
  const clearFlag = `clear-${flag}` as keyof ArchiveMetaFlagValues;
  const clearValue = values[clearFlag];

  if (value !== undefined && clearValue === true) {
    throw new Error(
      withHelpRoute(
        `Cannot combine --${flag} with --clear-${flag}.`,
        helpRoute,
      ),
    );
  }
  if (value !== undefined) {
    const normalized = normalizeNonEmptyFlagValue(
      value,
      `--${flag}`,
      helpRoute,
    );

    return {
      [key]: normalized,
    };
  }
  if (clearValue === true) {
    const clearKey = `clear${key[0]!.toUpperCase()}${key.slice(1)}`;

    return {
      [clearKey]: true,
    } as Partial<ArchiveMetaPatch>;
  }

  return {};
}

function parseArchiveAuthorsMetaPatch(
  values: ArchiveMetaFlagValues,
  helpRoute: string,
): Partial<ArchiveMetaPatch> {
  if (values.author !== undefined && values["clear-authors"] === true) {
    throw new Error(
      withHelpRoute("Cannot combine --author with --clear-authors.", helpRoute),
    );
  }
  if (values.author !== undefined) {
    return {
      authors: values.author.map((value) =>
        normalizeNonEmptyFlagValue(value, "--author", helpRoute),
      ),
    };
  }
  if (values["clear-authors"] === true) {
    return {
      clearAuthors: true,
    };
  }

  return {};
}

function normalizeNonEmptyFlagValue(
  value: string,
  flag: string,
  helpRoute: string,
): string {
  const normalized = value.trim();

  if (normalized === "") {
    throw new Error(withHelpRoute(`${flag} cannot be empty.`, helpRoute));
  }

  return normalized;
}

function rejectActionFlag(
  value: string | undefined,
  flag: string,
  action: string,
  helpRoute: string,
): void {
  if (value !== undefined) {
    throw new Error(
      withHelpRoute(
        `The \`chapter ${action}\` action does not support ${flag}.`,
        helpRoute,
      ),
    );
  }
}

function rejectActionBooleanFlag(
  value: boolean | undefined,
  flag: string,
  action: string,
  helpRoute: string,
): void {
  if (value !== undefined) {
    throw new Error(
      withHelpRoute(
        `The \`chapter ${action}\` action does not support ${flag}.`,
        helpRoute,
      ),
    );
  }
}

function rejectConflictingMoveFlags(
  values: {
    readonly after?: string;
    readonly before?: string;
    readonly first?: boolean;
    readonly last?: boolean;
    readonly parent?: string;
    readonly root?: boolean;
  },
  helpRoute: string,
): void {
  const parentTargets = [
    values.parent === undefined ? undefined : "--parent",
    values.root === undefined ? undefined : "--root",
  ].filter((flag): flag is string => flag !== undefined);
  const positionTargets = [
    values.before === undefined ? undefined : "--before",
    values.after === undefined ? undefined : "--after",
    values.first === undefined ? undefined : "--first",
    values.last === undefined ? undefined : "--last",
  ].filter((flag): flag is string => flag !== undefined);

  if (parentTargets.length > 1) {
    throw new Error(
      withHelpRoute(
        `Choose only one parent target: ${parentTargets.join(", ")}.`,
        helpRoute,
      ),
    );
  }
  if (positionTargets.length > 1) {
    throw new Error(
      withHelpRoute(
        `Choose only one position target: ${positionTargets.join(", ")}.`,
        helpRoute,
      ),
    );
  }
  if (
    parentTargets.length > 0 &&
    (values.before !== undefined || values.after !== undefined)
  ) {
    throw new Error(
      withHelpRoute(
        "Do not combine --parent or --root with --before or --after.",
        helpRoute,
      ),
    );
  }
  if (parentTargets.length === 0 && positionTargets.length === 0) {
    throw new Error(
      withHelpRoute(
        "`chapter move` requires --parent, --root, --before, --after, --first, or --last.",
        helpRoute,
      ),
    );
  }
}

function rejectArchiveChapterFlag(
  name: string,
  value: boolean | string | undefined,
  helpRoute: string,
): void {
  if (value !== undefined) {
    throw new Error(
      withHelpRoute(
        `The \`chapter\` command does not support --${name}.`,
        helpRoute,
      ),
    );
  }
}

function rejectArchiveChapterMetaFlags(
  values: ArchiveMetaFlagValues,
  helpRoute: string,
): void {
  for (const flag of listPresentMetaFlags(values, { includeTitle: false })) {
    throw new Error(
      withHelpRoute(
        `The \`chapter\` command does not support ${flag}.`,
        helpRoute,
      ),
    );
  }
}

function rejectHelpMetaFlags(values: ArchiveMetaFlagValues): void {
  for (const flag of listPresentMetaFlags(values)) {
    throw new Error(
      withHelpRoute(
        `The \`help\` command does not support ${flag}.`,
        CLI_HELP_ROUTES.root,
      ),
    );
  }
}

function rejectStatusMetaFlags(values: ArchiveMetaFlagValues): void {
  for (const flag of listPresentMetaFlags(values)) {
    throw new Error(
      withHelpRoute(
        `The \`config status\` command does not support ${flag}.`,
        "wikigraph config status --help",
      ),
    );
  }
}

function rejectTransformFlag(
  name: string,
  value: boolean | string | undefined,
  helpRoute: string,
): void {
  if (value !== undefined) {
    throw new Error(
      withHelpRoute(
        `The \`transform\` command does not support --${name}.`,
        helpRoute,
      ),
    );
  }
}

function rejectTransformMetaFlags(values: ArchiveMetaFlagValues): void {
  for (const flag of listPresentMetaFlags(values)) {
    throw new Error(
      withHelpRoute(
        `The \`transform\` command does not support ${flag}.`,
        "wikigraph transform --help",
      ),
    );
  }
}

function listPresentMetaFlags(
  values: ArchiveMetaFlagValues,
  options: { readonly includeTitle?: boolean } = {},
): readonly string[] {
  const includeTitle = options.includeTitle ?? true;
  const flags: string[] = [];

  if (values.author !== undefined) flags.push("--author");
  if (values["clear-authors"] !== undefined) flags.push("--clear-authors");
  if (values["clear-description"] !== undefined) {
    flags.push("--clear-description");
  }
  if (values["clear-identifier"] !== undefined) {
    flags.push("--clear-identifier");
  }
  if (values["clear-language"] !== undefined) flags.push("--clear-language");
  if (values["clear-published-at"] !== undefined) {
    flags.push("--clear-published-at");
  }
  if (values["clear-publisher"] !== undefined) flags.push("--clear-publisher");
  if (includeTitle && values["clear-title"] !== undefined) {
    flags.push("--clear-title");
  }
  if (values.description !== undefined) flags.push("--description");
  if (values.identifier !== undefined) flags.push("--identifier");
  if (values.language !== undefined) flags.push("--language");
  if (values["published-at"] !== undefined) flags.push("--published-at");
  if (values.publisher !== undefined) flags.push("--publisher");
  if (includeTitle && values.title !== undefined) flags.push("--title");

  return flags;
}

function requireChapterId(
  chapterId: number | undefined,
  action: CLIArchiveChapterAction,
  helpRoute: string,
): asserts chapterId is number {
  if (chapterId === undefined) {
    throw new Error(
      withHelpRoute(
        `Missing --chapter. \`chapter ${action}\` requires a chapter id.`,
        helpRoute,
      ),
    );
  }
}

function rejectHelpFlag(
  name: string,
  value: boolean | string | undefined,
): void {
  if (value !== undefined) {
    throw new Error(
      withHelpRoute(
        `The \`help\` command does not support --${name}.`,
        CLI_HELP_ROUTES.root,
      ),
    );
  }
}

function rejectStatusFlag(
  name: string,
  value: boolean | string | undefined,
): void {
  if (value !== undefined) {
    throw new Error(
      withHelpRoute(
        `The \`config status\` command does not support --${name}.`,
        "wikigraph config status --help",
      ),
    );
  }
}

function isArchiveAction(value: string | undefined): value is CLIArchiveAction {
  return (
    value === "create" ||
    value === "evidence" ||
    value === "estimate" ||
    value === "export" ||
    value === "get" ||
    value === "list" ||
    value === "next" ||
    value === "pack" ||
    value === "related" ||
    value === "search"
  );
}

function isArchiveUriAction(
  value: string | undefined,
): value is CLIArchiveUriAction {
  return (
    isArchiveAction(value) ||
    isArchiveChapterAction(value) ||
    value === "queue" ||
    value === "set"
  );
}

function isUriFirstArchiveAction(
  value: string | undefined,
): value is "evidence" | "get" | "list" | "pack" | "related" | "search" {
  return (
    value === "evidence" ||
    value === "get" ||
    value === "list" ||
    value === "pack" ||
    value === "related" ||
    value === "search"
  );
}

function isWikiGraphUri(value: string | undefined): boolean {
  return value?.startsWith("wkg://") === true;
}

function isWikiGraphJobUri(value: string | undefined): boolean {
  return value?.startsWith("wkg-job://") === true;
}

function parseWikiGraphJobUri(uri: string): string | undefined {
  const prefix = "wkg-job://";
  if (!uri.startsWith(prefix)) {
    throw new Error(
      withHelpRoute(
        `Expected a Wiki Graph job URI: ${uri}`,
        "wikigraph queue --help",
      ),
    );
  }

  const jobId = uri.slice(prefix.length).trim();
  if (jobId === "") {
    return undefined;
  }

  return jobId;
}

function requireArchiveUriPath(uri: string, helpRoute: string): string {
  const parsed = parseLocatedWikiGraphUri(uri);

  if (parsed.archivePath === undefined || parsed.objectUri !== undefined) {
    throw new Error(
      withHelpRoute(`Expected an archive Wiki Graph URI: ${uri}`, helpRoute),
    );
  }

  return parsed.archivePath;
}

function isJobUriAction(value: string | undefined): value is CLIJobAction {
  return (
    value === "boost" ||
    value === "cancel" ||
    value === "get" ||
    value === "list" ||
    value === "pause" ||
    value === "resume" ||
    value === "set" ||
    value === "status" ||
    value === "target" ||
    value === "watch"
  );
}

function isQueueAction(value: string | undefined): value is CLIQueueAction {
  return (
    value === "add" ||
    value === "boost" ||
    value === "cancel" ||
    value === "clean" ||
    value === "list" ||
    value === "pause" ||
    value === "resume" ||
    value === "status" ||
    value === "target" ||
    value === "watch" ||
    value === "worker"
  );
}

function parseBuildJobTarget(value: string | undefined): BuildJobTarget {
  switch (value) {
    case undefined:
    case "reading-summary":
      return "reading-summary";
    case "reading-graph":
      return "reading-graph";
    case "knowledge-graph":
      return "knowledge-graph";
    default:
      throw new Error(
        withHelpRoute(
          `Invalid queue task: ${value}. Expected reading-graph, reading-summary, or knowledge-graph.`,
          "wikigraph queue --help",
        ),
      );
  }
}

function parseWatchFrom(
  value: string | undefined,
  helpRoute: string,
): "beginning" | "now" | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "beginning" || value === "now") {
    return value;
  }

  throw new Error(
    withHelpRoute(
      `Invalid --from: ${value}. Expected beginning or now.`,
      helpRoute,
    ),
  );
}

function parseArchiveEstimateStage(value: string | undefined): ChapterStage {
  if (value === undefined) {
    return "summarized";
  }

  return parseChapterStage(value, "--stage", CLI_HELP_ROUTES.command);
}

function parseResultFormat(values: {
  readonly json?: boolean;
  readonly jsonl?: boolean;
}): CLIResultFormat {
  if (values.json === true && values.jsonl === true) {
    throw new Error(
      withHelpRoute(
        "`--json` and `--jsonl` cannot be combined.",
        CLI_HELP_ROUTES.command,
      ),
    );
  }

  if (values.json === true) {
    return "json";
  }
  if (values.jsonl === true) {
    return "jsonl";
  }

  return "text";
}

function parseEvidenceFlag(
  value: string | undefined,
  helpRoute: string,
): { readonly evidenceLimit?: number } {
  if (value === undefined) {
    return {};
  }

  return {
    evidenceLimit: parseNonNegativeIntegerFlag(value, "--evidence", helpRoute),
  };
}

function parseSourceContextFlag(
  value: string | undefined,
  helpRoute: string,
): { readonly context?: number } {
  if (value === undefined) {
    return {};
  }

  return {
    context: parseNonNegativeIntegerFlag(value, "--context", helpRoute),
  };
}

function parseRelatedRoleFlag(
  value: string | undefined,
  helpRoute: string,
): { readonly role?: "any" | "object" | "self" | "subject" } {
  if (value === undefined) {
    return {};
  }
  if (
    value !== "any" &&
    value !== "object" &&
    value !== "self" &&
    value !== "subject"
  ) {
    throw new Error(
      withHelpRoute(
        "--role must be one of: any, subject, object, self.",
        helpRoute,
      ),
    );
  }

  return { role: value };
}

function parseNonNegativeIntegerFlag(
  value: string,
  flag: string,
  helpRoute: string,
): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(
      withHelpRoute(`${flag} must be a non-negative integer.`, helpRoute),
    );
  }

  return parsed;
}

function parsePositiveIntegerFlag(
  value: string,
  flag: string,
  helpRoute: string,
): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      withHelpRoute(`${flag} must be a positive integer.`, helpRoute),
    );
  }

  return parsed;
}

function normalizeArchiveInlineOptions(
  positionals: readonly string[],
  values: ArchiveArgumentValues,
): {
  readonly positionals: readonly string[];
  readonly values: ArchiveArgumentValues;
} {
  const normalizedPositionals: string[] = [];
  const normalizedValues: Record<
    string,
    boolean | readonly string[] | string | undefined
  > = {
    ...values,
  };

  for (let index = 0; index < positionals.length; index += 1) {
    const item = positionals[index];

    if (item === undefined) {
      continue;
    }

    switch (item) {
      case "--json":
      case "--confirm":
        normalizedValues[item.slice(2)] = true;
        continue;
      case "--budget":
      case "--chapter":
      case "--context":
      case "--cursor":
      case "--input":
      case "--input-format":
      case "--limit":
      case "--llm":
      case "--output":
      case "--output-format":
      case "--prompt":
      case "--stage":
      case "--to": {
        const value = positionals[index + 1];

        if (value === undefined) {
          normalizedPositionals.push(item);
          continue;
        }

        normalizedValues[item.slice(2)] = value;
        index += 1;
        continue;
      }
      default:
        normalizedPositionals.push(item);
    }
  }

  return {
    positionals: normalizedPositionals,
    values: normalizedValues,
  };
}

function normalizeArchiveValueFlagArgv(
  argv: readonly string[],
): readonly string[] {
  const normalized: string[] = [];
  let stopped = false;

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];

    if (item === undefined) {
      continue;
    }

    if (stopped) {
      normalized.push(item);
      continue;
    }

    if (item === "--") {
      normalized.push(item);
      stopped = true;
      continue;
    }

    if (item !== "--evidence" && item !== "--context") {
      normalized.push(item);
      continue;
    }

    const value = argv[index + 1];

    if (value !== undefined && !value.startsWith("-")) {
      normalized.push(item);
      normalized.push(value);
      index += 1;
      continue;
    }

    if (value !== undefined && /^-\d/.test(value)) {
      normalized.push(`${item}=${value}`);
      index += 1;
      continue;
    }

    normalized.push(item);
    if (item === "--evidence") {
      normalized.push("3");
    }
  }

  return normalized;
}

function rejectArchiveExtraPositionals(
  action: CLIArchiveAction,
  positionals: readonly string[],
  allowed: number,
  helpRoute: string,
): void {
  if (positionals.length > allowed) {
    throw new Error(
      withHelpRoute(
        `Unexpected positional arguments for \`${action}\`: ${positionals.slice(allowed).join(" ")}.`,
        helpRoute,
      ),
    );
  }
}

function rejectQueueExtraPositionals(
  action: CLIQueueAction,
  positionals: readonly string[],
  allowed: number,
  helpRoute: string,
): void {
  if (positionals.length > allowed) {
    throw new Error(
      withHelpRoute(
        `Unexpected positional arguments for \`queue ${action}\`: ${positionals.slice(allowed).join(" ")}.`,
        helpRoute,
      ),
    );
  }
}

function rejectArchiveMaintenanceExtraPositionals(
  command: CLIArchiveMaintenanceCommand,
  positionals: readonly string[],
  allowed: number,
  helpRoute: string,
): void {
  if (positionals.length > allowed) {
    throw new Error(
      withHelpRoute(
        `Unexpected positional arguments for \`${command}\`: ${positionals.slice(allowed).join(" ")}.`,
        helpRoute,
      ),
    );
  }
}

function rejectMetaCommandFlag(
  name: string,
  value: string | undefined,
  helpRoute: string,
): void {
  if (value !== undefined) {
    throw new Error(
      withHelpRoute(
        `The \`meta\` command does not support --${name}.`,
        helpRoute,
      ),
    );
  }
}

function rejectMetaCommandBooleanFlag(
  name: string,
  value: boolean | undefined,
  helpRoute: string,
): void {
  if (value !== undefined) {
    throw new Error(
      withHelpRoute(
        `The \`meta\` command does not support --${name}.`,
        helpRoute,
      ),
    );
  }
}

function rejectCoverCommandFlag(
  name: string,
  value: string | undefined,
  helpRoute: string,
): void {
  if (value !== undefined) {
    throw new Error(
      withHelpRoute(
        `The \`cover\` command does not support --${name}.`,
        helpRoute,
      ),
    );
  }
}

function rejectCoverCommandBooleanFlag(
  name: string,
  value: boolean | undefined,
  helpRoute: string,
): void {
  if (value !== undefined) {
    throw new Error(
      withHelpRoute(
        `The \`cover\` command does not support --${name}.`,
        helpRoute,
      ),
    );
  }
}

function rejectCoverMetaFlags(values: ArchiveMetaFlagValues): void {
  for (const flag of listPresentMetaFlags(values)) {
    throw new Error(
      withHelpRoute(
        `The \`cover\` command does not support ${flag}.`,
        "wikigraph cover --help",
      ),
    );
  }
}

function rejectArchiveFlag(
  action: CLIArchiveAction,
  flag: string,
  value: string | undefined,
  helpRoute: string,
): void {
  if (value !== undefined) {
    throw new Error(
      withHelpRoute(
        `The \`${action}\` command does not support ${flag}.`,
        helpRoute,
      ),
    );
  }
}

function rejectArchiveBooleanFlag(
  action: CLIArchiveAction,
  flag: string,
  value: boolean | undefined,
  helpRoute: string,
): void {
  if (value !== undefined) {
    throw new Error(
      withHelpRoute(
        `The \`${action}\` command does not support ${flag}.`,
        helpRoute,
      ),
    );
  }
}

function rejectArchiveNonReadFlags(
  action: CLIArchiveAction,
  values: {
    readonly input?: string;
    readonly "input-format"?: string;
    readonly llm?: string;
    readonly output?: string;
    readonly "output-format"?: string;
    readonly prompt?: string;
  },
  helpRoute: string,
): void {
  rejectArchiveFlag(action, "--input", values.input, helpRoute);
  rejectArchiveFlag(
    action,
    "--input-format",
    values["input-format"],
    helpRoute,
  );
  rejectArchiveFlag(action, "--llm", values.llm, helpRoute);
  rejectArchiveFlag(action, "--output", values.output, helpRoute);
  rejectArchiveFlag(
    action,
    "--output-format",
    values["output-format"],
    helpRoute,
  );
  rejectArchiveFlag(action, "--prompt", values.prompt, helpRoute);
}
