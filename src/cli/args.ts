import { parseArgs } from "util";

import {
  type CLIFormat,
  inferCLIFormatFromPath,
  parseCLIFormat,
} from "./formats.js";
import { CLI_HELP_ROUTES, withHelpRoute } from "./errors.js";
import {
  type ArchiveTriplePattern,
  type BuildJobTarget,
  type ChapterStage,
} from "../facade/index.js";
import {
  isUriHelpPredicate,
  parseHelpTopic,
  renderArchiveCommandHelpText,
  renderArchiveMaintenanceCommandHelpText,
  renderGcCommandHelpText,
  renderHelpTopicText,
  renderLegacyCommandHelpText,
  renderMainHelpText,
  renderArchiveMaintenanceChapterActionHelpText,
  renderTransformHelpText,
  renderUriHelpText,
  renderUriPredicateHelpText,
  type UriHelpTargetName,
} from "./help.js";
import {
  parseLocalConfigSection,
  type LocalConfigSection,
} from "./local-config-store.js";
import { formatCliCommand } from "./shell.js";
import {
  formatLocatedChapterResourceUri,
  formatLocatedChapterSourceCollectionUri,
  formatLocatedChapterUri,
  parseLocatedWikiGraphUri,
  WIKI_GRAPH_JOB_URI_PREFIX,
  WIKI_GRAPH_URI_PREFIX,
} from "../wikg/index.js";

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
  readonly afterChapterId?: number;
  readonly beforeChapterId?: number;
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
type CLIArchiveRootAction = CLIArchiveAction;
type CLIArchiveUriAction =
  | CLIArchiveRootAction
  | CLIArchiveChapterAction
  | CLIArchiveIndexAction
  | CLIMetadataAction;
type CLIJobAction =
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
      force: {
        type: "boolean",
      },
      input: {
        type: "string",
      },
      import: {
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
      "json-input": {
        type: "string",
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
      query: {
        type: "string",
      },
      replace: {
        type: "boolean",
      },
      reverse: {
        type: "boolean",
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
      secret: {
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

  rejectNonGcForceFlag(positionals, values);
  rejectNonCreateReplaceFlag(positionals, values);

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
    !(isWikiGraphJobUri(positionals[0]) && positionals[1] === "add")
  ) {
    throw new Error(
      withHelpRoute(
        "`--accept-cost` is only valid for `wg wikg://local/job add`.",
        "wg wikg://local/job add --help",
      ),
    );
  }

  if (
    values.reverse === true &&
    (positionals[0] === undefined ||
      (!isWikiGraphUri(positionals[0]) && positionals[0] !== "next"))
  ) {
    throw new Error("The current command does not support --reverse.");
  }

  if (positionals[0] === "help") {
    return parseHelpArguments(positionals.slice(1), values);
  }

  if (positionals[0] === "gc") {
    return parseGcArguments(positionals.slice(1), values);
  }

  if (positionals[0] === "__queue-worker") {
    return parseQueueWorkerArguments(positionals.slice(1), values);
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
    rejectArchiveBooleanFlag(
      positionals[1] ?? "job",
      "--reverse",
      values.reverse,
      "wg wikg://local/job --help",
    );
    return parseJobUriFirstArguments(positionals, values);
  }

  if (isWikiGraphLocalConfigUri(positionals[0])) {
    rejectArchiveBooleanFlag(
      positionals[1] ?? "config",
      "--reverse",
      values.reverse,
      "wg wikg://local/config --help",
    );
    return parseLocalConfigUriFirstArguments(positionals, values);
  }

  if (isWikiGraphUri(positionals[0])) {
    return parseArchiveUriFirstArguments(positionals, values);
  }

  if (
    isPublicArchiveCommandHelpAction(positionals[0]) &&
    values.help === true &&
    positionals.length === 1
  ) {
    return parseArchiveArguments(positionals[0], positionals.slice(1), values);
  }

  if (positionals.length === 0) {
    throw new Error(withHelpRoute("Missing command.", CLI_HELP_ROUTES.command));
  }
  throw new Error(formatUnknownCommandMessage(positionals[0]!));
}

function parseArchiveUriFirstArguments(
  positionals: readonly string[],
  values: ArchiveArgumentValues,
): ParsedCLIArguments {
  const uri = positionals[0];
  const explicitAction = positionals[1];

  if (uri === undefined) {
    throw new Error("Internal error: missing URI-first archive URI.");
  }

  const action =
    explicitAction ?? resolveImplicitArchiveUriAction(uri, values.query);

  if (isRemovedImplicitArchiveAction(explicitAction)) {
    throw new Error(formatRemovedImplicitVerbMessage(explicitAction));
  }

  if (values.help === true && explicitAction === undefined) {
    const helpTarget = classifyArchiveUriHelpTarget(uri);

    return {
      help: true,
      helpText: renderUriHelpText(helpTarget, uri),
      kind: "help",
    };
  }

  if (values.help === true && explicitAction !== undefined) {
    const helpTarget = classifyArchiveUriHelpTarget(uri);

    if (!isUriHelpPredicate(helpTarget, explicitAction)) {
      throw new Error(
        withHelpRoute(
          `The URI target ${uri} does not support \`${explicitAction}\`.`,
          formatWikiGraphHelpCommand(uri),
        ),
      );
    }
    return {
      help: true,
      helpText: renderUriPredicateHelpText(helpTarget, explicitAction, uri),
      kind: "help",
    };
  }

  if (!isArchiveUriAction(action)) {
    const helpCommand = formatWikiGraphHelpCommand(uri);

    throw new Error(
      withHelpRoute(
        `The URI-first form does not support \`${action}\`. Use \`${helpCommand}\` to inspect valid predicates.`,
        helpCommand,
      ),
    );
  }

  return parseArchiveUriTargetArguments(
    uri,
    action,
    explicitAction === undefined ? [] : positionals.slice(2),
    values,
  );
}

type ArchiveUriKind = "object" | "scope";

function resolveImplicitArchiveUriAction(
  uri: string,
  query: string | undefined,
): CLIArchiveUriAction {
  const parsed = parseLocatedWikiGraphUri(uri);

  if (parsed.archivePath === undefined) {
    throw new Error(formatMissingArchiveLocatorMessage(uri));
  }

  const kind = classifyArchiveUri(parsed.objectUri);

  if (kind === "scope") {
    return query === undefined ? "list" : "search";
  }
  if (query !== undefined) {
    throw new Error(
      withHelpRoute(
        "`--query` requires a scope URI, or an explicit `related` or `evidence` command for supported object URIs.",
        CLI_HELP_ROUTES.uri,
      ),
    );
  }

  return "get";
}

function classifyArchiveUri(objectUri: string | undefined): ArchiveUriKind {
  if (objectUri === undefined) {
    return "scope";
  }

  const path = stripObjectUriPrefix(objectUri);

  if (path === "chapter") {
    return "scope";
  }
  if (/^chapter\/[1-9][0-9]*$/u.test(path)) {
    return "scope";
  }
  if (/^chapter\/[1-9][0-9]*\/(?:chunk|entity)$/u.test(path)) {
    return "scope";
  }
  if (isTripleScopePath(path)) {
    return "scope";
  }
  if (/^(?:chunk|entity)$/u.test(path)) {
    return "scope";
  }

  return "object";
}

function classifyArchiveUriHelpTarget(uri: string): UriHelpTargetName {
  const parsed = parseLocatedWikiGraphUri(uri);
  const objectUri = parsed.objectUri;

  if (objectUri === undefined) {
    return "archive-scope";
  }

  const path = stripObjectUriPrefix(objectUri);

  if (path === "cover") {
    return "cover-object";
  }
  if (path === "index") {
    return "index-object";
  }
  if (path === "chapter") {
    return "chapter-collection-scope";
  }
  if (/^chapter\/[1-9][0-9]*$/u.test(path)) {
    return "chapter-scope";
  }
  if (path === "chapter/tree") {
    return "chapter-tree-object";
  }
  if (/^chapter\/[1-9][0-9]*\/state(?:\/.+)?$/u.test(path)) {
    return "chapter-state-object";
  }
  if (/^chapter\/[1-9][0-9]*\/source(?:#.*)?$/u.test(path)) {
    return "chapter-source-object";
  }
  if (/^chapter\/[1-9][0-9]*\/summary(?:#.*)?$/u.test(path)) {
    return "chapter-summary-object";
  }
  if (/^chapter\/[1-9][0-9]*\/title$/u.test(path)) {
    return "chapter-title-object";
  }
  if (/^(?:chapter\/[1-9][0-9]*\/)?chunk$/u.test(path)) {
    return "chunk-scope";
  }
  if (/^(?:chapter\/[1-9][0-9]*\/)?chunk\/.+$/u.test(path)) {
    return "chunk-object";
  }
  if (/^(?:chapter\/[1-9][0-9]*\/)?entity$/u.test(path)) {
    return "entity-scope";
  }
  if (/^(?:chapter\/[1-9][0-9]*\/)?entity\/[^/]+\/wikipage$/u.test(path)) {
    return "entity-wikipage-object";
  }
  if (/^(?:chapter\/[1-9][0-9]*\/)?entity\/.+$/u.test(path)) {
    return "entity-object";
  }
  if (isTripleScopePath(path)) {
    return "triple-scope";
  }
  if (/^(?:chapter\/[1-9][0-9]*\/)?triple(?:\/.*)?$/u.test(path)) {
    return "triple-object";
  }

  throw new Error(
    withHelpRoute(
      `Unknown Wiki Graph URI target: ${uri}. Use the archive root help or URI guide to choose a valid target.`,
      CLI_HELP_ROUTES.uri,
    ),
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
  const helpRoute = isImplicitArchiveReadAction(action)
    ? formatWikiGraphHelpCommand(uri)
    : formatWikiGraphHelpCommand(uri, action);

  if (archivePath === undefined) {
    throw new Error(formatMissingArchiveLocatorMessage(uri));
  }
  rejectUnsupportedArchiveReverse(action, values.reverse, helpRoute);

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

  const metadataTarget = parseMetadataTarget(objectUri);
  if (metadataTarget !== undefined) {
    return parseMetadataUriArguments(
      archivePath,
      metadataTarget,
      action,
      tail,
      values,
      helpRoute,
    );
  }

  if (containsMetadataKeySuffix(objectUri)) {
    throw new Error(
      withHelpRoute(
        "Metadata keys are not addressed in the URI. Read `<object>/meta` and filter the output, or use `<object>/meta put <key> ...`.",
        "wg <object-uri>/meta --help",
      ),
    );
  }

  if (objectUri === "wikg://cover") {
    return parseArchiveCoverUriArguments(
      uri,
      archivePath,
      action,
      tail,
      values,
    );
  }

  if (objectUri === "wikg://index") {
    return parseArchiveIndexUriArguments(archivePath, action, tail, values);
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

  const uriKind = classifyArchiveUri(objectUri);
  if (uriKind === "object" && (action === "list" || action === "search")) {
    throw new Error(
      withHelpRoute(
        `The object URI ${uri} does not support \`${action}\`. Use a scope URI directly, or add --query to a scope URI.`,
        CLI_HELP_ROUTES.uri,
      ),
    );
  }
  if (uriKind === "scope" && action === "get") {
    throw new Error(
      withHelpRoute(
        `The scope URI ${uri} cannot be read as one object. Use a concrete object URI.`,
        CLI_HELP_ROUTES.uri,
      ),
    );
  }

  if (!isUriFirstArchiveAction(action)) {
    const helpCommand = formatWikiGraphHelpCommand(uri);

    throw new Error(
      withHelpRoute(
        `The URI target ${uri} does not support \`${action}\`. Use \`${helpCommand}\` to inspect valid predicates.`,
        helpCommand,
      ),
    );
  }

  return parseArchiveArguments(action, [uri, ...tail], values, helpRoute);
}

function rejectUnsupportedArchiveReverse(
  action: CLIArchiveUriAction,
  reverse: boolean | undefined,
  helpRoute: string,
): void {
  if (reverse !== true) {
    return;
  }
  if (action === "search") {
    throw new Error(
      withHelpRoute("`--reverse` cannot be combined with --query.", helpRoute),
    );
  }
  if (
    action === "evidence" ||
    action === "get" ||
    action === "list" ||
    action === "related"
  ) {
    return;
  }

  rejectArchiveBooleanFlag(action, "--reverse", reverse, helpRoute);
}

function parseArchiveIndexUriArguments(
  archivePath: string,
  action: CLIArchiveUriAction,
  tail: readonly string[],
  values: ArchiveArgumentValues,
): ParsedCLIArguments {
  const helpRoute = `wg wikg://<archive.wikg>/index ${action} --help`;

  if (values.help === true) {
    return {
      help: true,
      helpText: renderUriHelpText(
        "index-object",
        "wikg://<archive.wikg>/index",
      ),
      kind: "help",
    };
  }

  if (!isArchiveIndexAction(action)) {
    throw new Error(
      withHelpRoute(
        `The index object does not support \`${action}\`. Read the index object directly, or use enable, disable, embed, or external.`,
        CLI_HELP_ROUTES.uri,
      ),
    );
  }
  rejectArchiveExtraPositionals(action, tail, 0, helpRoute);
  rejectArchiveNonReadFlags(action, values, helpRoute);
  rejectArchiveFlag(action, "--after", values.after, helpRoute);
  rejectArchiveFlag(action, "--budget", values.budget, helpRoute);
  rejectArchiveFlag(action, "--before", values.before, helpRoute);
  rejectArchiveFlag(action, "--chapter", values.chapter, helpRoute);
  rejectArchiveFlag(action, "--context", values.context, helpRoute);
  rejectArchiveFlag(action, "--cursor", values.cursor, helpRoute);
  rejectArchiveFlag(action, "--digest-dir", values["digest-dir"], helpRoute);
  rejectArchiveFlag(action, "--evidence", values.evidence, helpRoute);
  rejectArchiveFlag(action, "--from", values.from, helpRoute);
  rejectArchiveFlag(action, "--json-input", values["json-input"], helpRoute);
  rejectArchiveFlag(action, "--limit", values.limit, helpRoute);
  rejectArchiveFlag(action, "--parent", values.parent, helpRoute);
  rejectArchiveFlag(action, "--predicate", values.predicate, helpRoute);
  rejectArchiveFlag(action, "--role", values.role, helpRoute);
  rejectArchiveFlag(action, "--stage", values.stage, helpRoute);
  rejectArchiveFlag(action, "--task", values.task, helpRoute);
  rejectArchiveFlag(action, "--to", values.to, helpRoute);
  rejectArchiveBooleanFlag(
    action,
    "--accept-cost",
    values["accept-cost"],
    helpRoute,
  );
  rejectArchiveBooleanFlag(action, "--active", values.active, helpRoute);
  rejectArchiveBooleanFlag(action, "--all", values.all, helpRoute);
  rejectArchiveBooleanFlag(action, "--backlinks", values.backlinks, helpRoute);
  rejectArchiveBooleanFlag(action, "--boost", values.boost, helpRoute);
  rejectArchiveBooleanFlag(action, "--clear", values.clear, helpRoute);
  rejectArchiveBooleanFlag(action, "--confirm", values.confirm, helpRoute);
  rejectArchiveBooleanFlag(action, "--dry-run", values["dry-run"], helpRoute);
  rejectArchiveBooleanFlag(action, "--first", values.first, helpRoute);
  if (action === "enable") {
    rejectStreamingJSONFlag(action, values.json, helpRoute);
  } else {
    rejectArchiveBooleanFlag(action, "--jsonl", values.jsonl, helpRoute);
  }
  rejectArchiveBooleanFlag(action, "--last", values.last, helpRoute);
  rejectArchiveBooleanFlag(action, "--reverse", values.reverse, helpRoute);
  rejectArchiveBooleanFlag(action, "--root", values.root, helpRoute);
  rejectArchiveBooleanFlag(action, "--verbose", values.verbose, helpRoute);
  rejectCommandMetaFlags(values, action, helpRoute);

  return {
    args: {
      action,
      archivePath,
      ...(values.json === undefined ? {} : { json: values.json }),
      ...(values.jsonl === undefined ? {} : { jsonl: values.jsonl }),
    },
    help: false,
    kind: "archive-index",
  };
}

function parseMetadataUriArguments(
  archivePath: string,
  objectPath: string,
  action: CLIArchiveUriAction,
  tail: readonly string[],
  values: ArchiveArgumentValues,
  helpRoute: string,
): ParsedCLIArguments {
  if (!isMetadataAction(action)) {
    throw new Error(
      withHelpRoute(
        `The metadata object does not support \`${action}\`. Read it directly, or use set, put, delete, or clear.`,
        "wg <object-uri>/meta --help",
      ),
    );
  }
  rejectMetadataFlags(action, values, helpRoute);

  switch (action) {
    case "get":
    case "clear":
      rejectArchiveMaintenanceExtraPositionals("meta", tail, 0, helpRoute);
      break;
    case "delete":
      rejectArchiveMaintenanceExtraPositionals("meta", tail, 1, helpRoute);
      if (tail[0] === undefined) {
        throw new Error(withHelpRoute("Missing metadata key.", helpRoute));
      }
      break;
    case "put":
      rejectArchiveMaintenanceExtraPositionals("meta", tail, 2, helpRoute);
      if (tail[0] === undefined) {
        throw new Error(withHelpRoute("Missing metadata key.", helpRoute));
      }
      break;
    case "set":
      rejectArchiveMaintenanceExtraPositionals("meta", tail, 1, helpRoute);
      break;
  }

  return {
    args: {
      action,
      archivePath,
      ...(values.input === undefined ? {} : { inputPath: values.input }),
      ...(action !== "set" && action !== "put"
        ? {}
        : tail[action === "put" ? 1 : 0] === undefined
          ? {}
          : { inputValue: tail[action === "put" ? 1 : 0] }),
      ...(values.json === undefined ? {} : { json: values.json }),
      ...(values["json-input"] === undefined
        ? {}
        : { jsonInputValue: values["json-input"] }),
      ...(tail[0] === undefined || (action !== "put" && action !== "delete")
        ? {}
        : { key: tail[0] }),
      ...(values.llm === undefined ? {} : { llmJSON: values.llm }),
      objectPath,
    },
    help: false,
    kind: "object-metadata",
  };
}

function rejectMetadataFlags(
  action: CLIMetadataAction,
  values: ArchiveArgumentValues,
  helpRoute: string,
): void {
  rejectMetaCommandFlag("budget", values.budget, helpRoute);
  rejectMetaCommandFlag("chapter", values.chapter, helpRoute);
  rejectMetaCommandFlag("cursor", values.cursor, helpRoute);
  rejectMetaCommandFlag("digest-dir", values["digest-dir"], helpRoute);
  rejectMetaCommandFlag("import", values.import, helpRoute);
  rejectMetaCommandFlag("input-format", values["input-format"], helpRoute);
  rejectMetaCommandFlag("limit", values.limit, helpRoute);
  rejectMetaCommandFlag("output", values.output, helpRoute);
  rejectMetaCommandFlag("output-format", values["output-format"], helpRoute);
  rejectMetaCommandFlag("prompt", values.prompt, helpRoute);
  rejectMetaCommandFlag("stage", values.stage, helpRoute);
  rejectMetaCommandFlag("to", values.to, helpRoute);
  rejectMetaCommandBooleanFlag("confirm", values.confirm, helpRoute);
  rejectMetaCommandBooleanFlag("jsonl", values.jsonl, helpRoute);
  rejectArchiveChapterMetaFlags(values, helpRoute);
  if (values.verbose === true) {
    throw new Error(
      withHelpRoute(
        "The metadata command does not support --verbose.",
        helpRoute,
      ),
    );
  }
  if (action === "get") {
    rejectMetaCommandFlag("input", values.input, helpRoute);
    rejectMetaCommandFlag("json-input", values["json-input"], helpRoute);
    return;
  }
  if (action === "clear" || action === "delete") {
    rejectMetaCommandFlag("input", values.input, helpRoute);
    rejectMetaCommandFlag("json-input", values["json-input"], helpRoute);
  }
}

function parseMetadataTarget(objectUri: string): string | undefined {
  const path = stripObjectUriPrefix(objectUri);

  if (path === "meta") {
    return "";
  }
  if (!path.endsWith("/meta")) {
    return undefined;
  }

  return path.slice(0, -"/meta".length);
}

function containsMetadataKeySuffix(objectUri: string): boolean {
  return /(?:^|\/)meta\/.+/u.test(stripObjectUriPrefix(objectUri));
}

function parseArchiveUriArchiveArguments(
  uri: string,
  archivePath: string,
  action: CLIArchiveUriAction,
  tail: readonly string[],
  values: ArchiveArgumentValues,
  helpRoute: string,
): ParsedCLIArguments {
  if (!isArchiveAction(action)) {
    throw new Error(
      withHelpRoute(
        `The archive URI form does not support \`${action}\`. Use \`wg <archive-uri> --help\` to inspect valid verbs.`,
        "wg <archive-uri> --help",
      ),
    );
  }

  if (action === "get") {
    return parseArchiveArguments(action, [uri, ...tail], values, helpRoute);
  }

  if (
    action !== "create" &&
    action !== "export" &&
    action !== "inspect" &&
    action !== "list" &&
    action !== "search"
  ) {
    throw new Error(
      withHelpRoute(
        `The archive URI ${uri} cannot be used with \`${action}\`; use a concrete object URI. Use \`wg <archive-uri> --help\` to inspect valid archive verbs.`,
        "wg <archive-uri> --help",
      ),
    );
  }

  return parseArchiveArguments(
    action,
    [action === "create" || action === "export" ? archivePath : uri, ...tail],
    values,
    helpRoute,
  );
}

function parseArchiveCoverUriArguments(
  uri: string,
  archivePath: string,
  action: CLIArchiveUriAction,
  tail: readonly string[],
  values: ArchiveArgumentValues,
): ParsedCLIArguments {
  const helpRoute = formatWikiGraphHelpCommand(uri, action);

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
        `The cover object does not support \`${action}\`. Read the cover URI directly.`,
        "wg <cover-uri> --help",
      ),
    );
  }

  rejectArchiveMaintenanceExtraPositionals("cover", tail, 0, helpRoute);
  rejectCoverCommandFlag("budget", values.budget, helpRoute);
  rejectCoverCommandFlag("chapter", values.chapter, helpRoute);
  rejectCoverCommandFlag("cursor", values.cursor, helpRoute);
  rejectCoverCommandFlag("digest-dir", values["digest-dir"], helpRoute);
  rejectCoverCommandFlag("import", values.import, helpRoute);
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
  if (objectUri === "wikg://chapter") {
    return { kind: "collection" };
  }

  if (objectUri === "wikg://chapter/tree") {
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

  const match = /^wikg:\/\/chapter\/([1-9][0-9]*)(?:\/(.*))?\/?$/u.exec(
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
  if (!objectUri.startsWith("wikg://triple/")) {
    return undefined;
  }

  return parseTriplePatternSuffix(objectUri.slice("wikg://".length));
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

function isTripleScopePath(path: string): boolean {
  if (path === "triple" || /^chapter\/[1-9][0-9]*\/triple$/u.test(path)) {
    return true;
  }

  const suffix = path.startsWith("chapter/")
    ? /^chapter\/[1-9][0-9]*\/(.+)$/u.exec(path)?.[1]
    : path;

  return suffix === undefined
    ? false
    : parseTriplePatternSuffix(suffix) !== undefined;
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
    case "wikg://chapter":
      return "chapter";
    case "wikg://chunk":
      return "chunk";
    case "wikg://entity":
      return "entity";
    case "wikg://triple":
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
  const helpRoute = formatWikiGraphHelpCommand(uri, action);

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
        `The chapter collection does not support \`${action}\`. Read it directly, add --query, or use add.`,
        "wg <chapter-uri> --help",
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
        `The ${lens} collection does not support \`${action}\`. Read it directly, or add --query.`,
        `wg <scope-uri> --help`,
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
        `The triple pattern collection does not support \`${action}\`. Read it directly, or add --query.`,
        "wg <triple-uri> --help",
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
        `The chapter tree does not support \`${action}\`. Read it directly, or use set.`,
        "wg <archive-uri>/chapter/tree --help",
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
      throw new Error(
        withHelpRoute(
          "`chapter/<id>` is a scope URI. Use `chapter/<id>/title` or `chapter/<id>/state` to read a concrete chapter object.",
          CLI_HELP_ROUTES.uri,
        ),
      );
    case "inspect":
      return parseArchiveArguments(
        "inspect",
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
    default:
      throw new Error(
        withHelpRoute(
          `The chapter object does not support \`${action}\`.`,
          "wg <chapter-uri> --help",
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
        `The chapter ${lens} collection does not support \`${action}\`. Read it directly, or add --query.`,
        `wg <scope-uri> --help`,
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
        `The chapter triple pattern collection does not support \`${action}\`. Read it directly, or add --query.`,
        "wg <triple-uri> --help",
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
        `The chapter state object does not support \`${action}\`. Read the state URI directly.`,
        "wg <chapter-uri>/state --help",
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
  const resourceHelpRoute = `wg <chapter-uri>/${resource} --help`;

  if (action === "list" || action === "search") {
    throw new Error(
      withHelpRoute(
        `The chapter ${resource} resource does not support \`${action}\`.`,
        resourceHelpRoute,
      ),
    );
  }

  if (action !== "set" && action !== "get" && action !== "clear") {
    throw new Error(
      withHelpRoute(
        `The chapter ${resource} resource does not support \`${action}\`. Read it directly, or use set.`,
        resourceHelpRoute,
      ),
    );
  }
  if (action === "clear" && resource !== "title") {
    throw new Error(
      withHelpRoute(
        `The chapter ${resource} resource does not support clear.`,
        resourceHelpRoute,
      ),
    );
  }
  if (action === "set" && values.clear === true) {
    throw new Error(
      withHelpRoute(
        `The chapter ${resource} set command does not support --clear. Use \`clear\`.`,
        resourceHelpRoute,
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
    {
      ...values,
      chapter: String(chapterId),
      ...(action === "clear" ? { clear: true } : {}),
    },
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

  const maxPositionals =
    action === "set-source" ||
    action === "set-summary" ||
    action === "set-title"
      ? 1
      : 0;
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
      tail[0],
    ),
    help: false,
    kind: "chapter",
  };
}

function parseJobUriFirstArguments(
  positionals: readonly string[],
  values: ArchiveArgumentValues,
): ParsedCLIArguments {
  const uri = positionals[0];
  const jobTargetUri = parseWikiGraphJobTargetUri(uri);
  const explicitAction = positionals[1];

  if (uri === undefined) {
    throw new Error("Internal error: missing job URI.");
  }

  if (isRemovedImplicitArchiveAction(explicitAction)) {
    throw new Error(formatRemovedImplicitVerbMessage(explicitAction));
  }

  if (values.help === true) {
    if (explicitAction === undefined) {
      return {
        help: true,
        helpText: renderUriHelpText(
          jobTargetUri === undefined && parseWikiGraphJobUri(uri) === undefined
            ? "job-collection-scope"
            : jobTargetUri === undefined
              ? "job-object"
              : "job-target-object",
          uri,
        ),
        kind: "help",
      };
    }
    const targetName =
      jobTargetUri === undefined && parseWikiGraphJobUri(uri) === undefined
        ? "job-collection-scope"
        : jobTargetUri === undefined
          ? "job-object"
          : "job-target-object";
    if (isUriHelpPredicate(targetName, explicitAction)) {
      return {
        help: true,
        helpText: renderUriPredicateHelpText(targetName, explicitAction, uri),
        kind: "help",
      };
    }
  }

  const jobId = jobTargetUri ?? parseWikiGraphJobUri(uri);
  const action =
    explicitAction ??
    (jobTargetUri !== undefined
      ? undefined
      : jobId === undefined
        ? "list"
        : "get");

  if (!isJobUriAction(action)) {
    throw new Error(
      withHelpRoute(
        action === undefined
          ? `Missing action after ${uri}.`
          : `The job URI form does not support \`${action}\`.`,
        "wg wikg://local/job --help",
      ),
    );
  }

  const helpRoute =
    explicitAction === undefined
      ? formatWikiGraphHelpCommand(uri)
      : formatWikiGraphHelpCommand(uri, action);
  const tail = explicitAction === undefined ? [] : positionals.slice(2);

  if (jobTargetUri !== undefined) {
    if (action !== "set") {
      throw new Error(
        withHelpRoute(
          `The job target URI form does not support \`${action}\`. Expected set.`,
          "wg wikg://local/job/<job-id>/target set --help",
        ),
      );
    }
    return parseQueueJobTargetUriArguments(
      jobTargetUri,
      tail,
      values,
      helpRoute,
    );
  }

  switch (action) {
    case "add":
      if (jobId !== undefined) {
        throw new Error(
          withHelpRoute("Job add requires `wikg://local/job`.", helpRoute),
        );
      }
      return parseQueueAddArguments(tail, values, helpRoute);
    case "clean":
      if (jobId !== undefined) {
        throw new Error(
          withHelpRoute("Job clean requires `wikg://local/job`.", helpRoute),
        );
      }
      rejectQueueJSONFlag("clean", values.json, helpRoute);
      rejectQueueJSONLFlag("clean", values.jsonl, helpRoute);
      rejectQueueExtraPositionals("clean", ["clean", ...tail], 1, helpRoute);
      return {
        args: {
          action: "clean",
        },
        help: false,
        kind: "queue",
      };
    case "list":
      if (jobId !== undefined) {
        throw new Error(
          withHelpRoute("Job list requires `wikg://local/job`.", helpRoute),
        );
      }
      rejectQueueJSONLFlag("list", values.jsonl, helpRoute);
      rejectQueueExtraPositionals("list", ["list", ...tail], 1, helpRoute);
      return {
        args: {
          action: "list",
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
    case "get":
      return parseQueueJobArguments("status", jobId, tail, values, helpRoute);
    case "watch":
    case "pause":
    case "resume":
    case "cancel":
    case "boost":
      return parseQueueJobArguments(action, jobId, tail, values, helpRoute);
    case "set":
      throw new Error(
        withHelpRoute(
          "`wikg://local/job/<job-id> set` is not supported. Use `wikg://local/job/<job-id>/target set <target>`.",
          "wg wikg://local/job/<job-id>/target set --help",
        ),
      );
  }

  throw new Error("Internal error: unsupported job URI action.");
}

function parseLocalConfigUriFirstArguments(
  positionals: readonly string[],
  values: ArchiveArgumentValues,
): ParsedCLIArguments {
  const uri = positionals[0];

  if (uri === undefined) {
    throw new Error("Internal error: missing local config URI.");
  }

  const section = parseLocalConfigUriSection(uri);
  const explicitAction = positionals[1];

  if (isRemovedImplicitArchiveAction(explicitAction)) {
    throw new Error(formatRemovedImplicitVerbMessage(explicitAction));
  }

  const action = explicitAction ?? "get";
  const helpRoute =
    explicitAction === undefined
      ? formatWikiGraphHelpCommand(uri)
      : formatWikiGraphHelpCommand(uri, action);

  if (section === undefined) {
    throw new Error(
      withHelpRoute(
        "Expected a local config section URI such as wikg://local/config/llm.",
        CLI_HELP_ROUTES.config,
      ),
    );
  }
  if (values.help === true && explicitAction === undefined) {
    return {
      help: true,
      helpText: renderUriHelpText("local-config-section", uri),
      kind: "help",
    };
  }
  if (values.help === true && explicitAction !== undefined) {
    if (!isUriHelpPredicate("local-config-section", action)) {
      throw new Error(
        withHelpRoute(
          `The URI target ${uri} does not support \`${action}\`.`,
          formatWikiGraphHelpCommand(uri),
        ),
      );
    }
    return {
      help: true,
      helpText: renderUriPredicateHelpText("local-config-section", action, uri),
      kind: "help",
    };
  }
  if (!isLocalConfigAction(action)) {
    throw new Error(
      withHelpRoute(
        `The local config URI form does not support \`${action}\`. Pass the URI directly to read it, or use set, put, delete, clear, or test.`,
        helpRoute,
      ),
    );
  }

  return parseLocalConfigArguments(
    section,
    action,
    explicitAction === undefined ? [] : positionals.slice(2),
    values,
    helpRoute,
  );
}

function parseLocalConfigArguments(
  section: LocalConfigSection,
  action: CLILocalConfigAction,
  tail: readonly string[],
  values: ArchiveArgumentValues,
  helpRoute: string,
): ParsedCLIArguments {
  rejectLocalConfigFlags(action, values, helpRoute);

  switch (action) {
    case "get":
    case "clear":
    case "test":
      rejectArchiveExtraPositionals(action, tail, 0, helpRoute);
      break;
    case "delete":
      rejectArchiveExtraPositionals(action, tail, 1, helpRoute);
      if (tail[0] === undefined) {
        throw new Error(withHelpRoute("Missing config key.", helpRoute));
      }
      break;
    case "put":
      rejectArchiveExtraPositionals(
        action,
        tail,
        values.secret === true ? 1 : 2,
        helpRoute,
      );
      if (tail[0] === undefined) {
        throw new Error(withHelpRoute("Missing config key.", helpRoute));
      }
      if (
        values.secret !== true &&
        tail[1] === undefined &&
        values["json-input"] === undefined
      ) {
        throw new Error(withHelpRoute("Missing config value.", helpRoute));
      }
      break;
    case "set":
      rejectArchiveExtraPositionals(action, tail, 1, helpRoute);
      break;
  }

  return {
    args: {
      action,
      ...(tail[0] === undefined || (action !== "put" && action !== "delete")
        ? {}
        : { key: tail[0] }),
      ...(values.json === undefined ? {} : { json: values.json }),
      ...(values["json-input"] === undefined
        ? {}
        : { jsonInputValue: values["json-input"] }),
      ...(action !== "set" && action !== "put"
        ? {}
        : tail[action === "put" ? 1 : 0] === undefined
          ? {}
          : { inputValue: tail[action === "put" ? 1 : 0] }),
      section,
      ...(values.secret === undefined ? {} : { secret: values.secret }),
    },
    help: false,
    kind: "local-config",
  };
}

function rejectLocalConfigFlags(
  action: CLILocalConfigAction,
  values: ArchiveArgumentValues,
  helpRoute: string,
): void {
  rejectMetaCommandFlag("input", values.input, helpRoute);
  rejectMetaCommandFlag("llm", values.llm, helpRoute);
  rejectMetaCommandFlag("output", values.output, helpRoute);
  rejectMetaCommandFlag("prompt", values.prompt, helpRoute);
  rejectMetaCommandFlag("task", values.task, helpRoute);
  rejectMetaCommandBooleanFlag("jsonl", values.jsonl, helpRoute);
  rejectMetaCommandBooleanFlag("verbose", values.verbose, helpRoute);
  rejectCommandMetaFlags(values, action, helpRoute);

  if (values.secret === true && action !== "put") {
    throw new Error(
      withHelpRoute("`--secret` is only valid for config put.", helpRoute),
    );
  }
  if (action === "get" || action === "test") {
    return;
  }
  if (values.json === true && action !== "set" && action !== "put") {
    throw new Error(
      withHelpRoute(`\`${action}\` does not support --json.`, helpRoute),
    );
  }
}

function isLocalConfigAction(
  value: string | undefined,
): value is CLILocalConfigAction {
  return (
    value === "clear" ||
    value === "delete" ||
    value === "get" ||
    value === "put" ||
    value === "set" ||
    value === "test"
  );
}

function parseQueueJobTargetUriArguments(
  jobId: string,
  tail: readonly string[],
  values: ArchiveArgumentValues,
  helpRoute: string,
): ParsedCLIArguments {
  rejectQueueJSONFlag("target", values.json, helpRoute);
  rejectQueueJSONLFlag("target", values.jsonl, helpRoute);
  rejectQueueExtraPositionals(
    "target",
    ["target", jobId, ...tail],
    3,
    helpRoute,
  );

  const target = tail[0];
  if (target === undefined) {
    throw new Error(withHelpRoute("Missing build job target.", helpRoute));
  }

  return {
    args: {
      action: "target",
      jobId,
      target: parseBuildJobTarget(target),
    },
    help: false,
    kind: "queue",
  };
}

function parseTransformArguments(
  positionals: readonly string[],
  values: ArchiveArgumentValues,
): ParsedCLIArguments {
  const helpRoute = "wg transform --help";

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
  rejectTransformFlag("import", values.import, helpRoute);
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

function parseGcArguments(
  positionals: readonly string[],
  values: ArchiveArgumentValues & ArchiveMetaFlagValues,
): ParsedCLIArguments {
  const helpRoute = "wg gc --help";

  if (values.help === true) {
    return {
      help: true,
      helpText: renderGcCommandHelpText(),
      kind: "help",
    };
  }

  rejectGcFlag("digest-dir", values["digest-dir"], helpRoute);
  rejectGcFlag("import", values.import, helpRoute);
  rejectGcFlag("input", values.input, helpRoute);
  rejectGcFlag("input-format", values["input-format"], helpRoute);
  rejectGcFlag("jsonl", values.jsonl, helpRoute);
  rejectGcFlag("limit", values.limit, helpRoute);
  rejectGcFlag("llm", values.llm, helpRoute);
  rejectGcFlag("output", values.output, helpRoute);
  rejectGcFlag("output-format", values["output-format"], helpRoute);
  rejectGcFlag("prompt", values.prompt, helpRoute);
  rejectGcFlag("stage", values.stage, helpRoute);
  rejectGcMetaFlags(values);

  if (values.verbose === true) {
    throw new Error(
      withHelpRoute("The `gc` command does not support --verbose.", helpRoute),
    );
  }
  if (positionals.length > 0) {
    throw new Error(
      withHelpRoute(
        `Unexpected positional arguments for \`gc\`: ${positionals.join(" ")}.`,
        helpRoute,
      ),
    );
  }

  return {
    args: {
      ...(values["dry-run"] === undefined ? {} : { dryRun: values["dry-run"] }),
      ...(values.force === undefined ? {} : { force: values.force }),
      ...(values.json === undefined ? {} : { json: values.json }),
    },
    help: false,
    kind: "gc",
  };
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
    rejectLegacyFlag("--import", values.import);
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
        withHelpRoute("Missing legacy input path.", "wg legacy migrate --help"),
      );
    }
    if (positionals.length > 2) {
      throw new Error(
        withHelpRoute(
          `Unexpected positional arguments: ${positionals.slice(2).join(" ")}.`,
          "wg legacy migrate --help",
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
      "wg legacy --help",
    ),
  );
}

function rejectLegacyFlag(flag: string, value: unknown): void {
  if (value !== undefined) {
    throw new Error(
      withHelpRoute(
        `\`wg legacy migrate\` does not support ${flag}.`,
        "wg legacy migrate --help",
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

function parseQueueWorkerArguments(
  positionals: readonly string[],
  values: ArchiveArgumentValues,
): ParsedCLIArguments {
  const helpRoute = "wg help";

  rejectStreamingJSONFlag("worker", values.json, helpRoute);
  rejectQueueJSONLFlag("worker", values.jsonl, helpRoute);
  rejectQueueExtraPositionals(
    "worker",
    ["worker", ...positionals],
    1,
    helpRoute,
  );
  return {
    args: {
      action: "worker",
      ...(values.llm === undefined ? {} : { llmJSON: values.llm }),
    },
    help: false,
    kind: "queue",
  };
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
      `\`wg wikg://local/job ${action}\` does not support --json.`,
      helpRoute,
    ),
  );
}

function rejectStreamingJSONFlag(
  action: string,
  value: boolean | undefined,
  helpRoute: string,
): void {
  if (value !== true) {
    return;
  }

  throw new Error(
    withHelpRoute(
      `The \`${action}\` command does not support --json because it streams progress events. Use --jsonl for line-delimited progress output.`,
      helpRoute,
    ),
  );
}

function parseQueueAddArguments(
  tail: readonly string[],
  values: ArchiveArgumentValues,
  helpRoute: string,
): ParsedCLIArguments {
  const action = "add";

  rejectQueueJSONLFlag(action, values.jsonl, helpRoute);
  rejectQueueFlag(action, "--stage", values.stage, helpRoute);
  rejectQueueFlag(action, "--to", values.to, helpRoute);
  rejectQueueFlag(action, "--chapter", values.chapter, helpRoute);
  rejectQueueExtraPositionals(action, [action, ...tail], 1, helpRoute);
  if (values.input === undefined) {
    throw new Error(withHelpRoute("Missing --input.", helpRoute));
  }

  const input = parseQueueAddInput(values.input, helpRoute);

  return {
    args: {
      action,
      ...(values["accept-cost"] === undefined
        ? {}
        : { acceptCost: values["accept-cost"] }),
      archivePath: input.archivePath,
      ...(values.boost === undefined ? {} : { boost: values.boost }),
      ...(input.chapterId === undefined ? {} : { chapterId: input.chapterId }),
      inputPath: values.input,
      ...(values.json === undefined ? {} : { json: values.json }),
      ...(values.llm === undefined ? {} : { llmJSON: values.llm }),
      ...(values.prompt === undefined ? {} : { prompt: values.prompt }),
      target: parseBuildJobTarget(values.task),
    },
    help: false,
    kind: "queue",
  };
}

function parseQueueAddInput(
  uri: string,
  helpRoute: string,
): { readonly archivePath: string; readonly chapterId?: number } {
  const parsed = parseLocatedWikiGraphUri(uri);

  if (parsed.archivePath === undefined) {
    throw new Error(
      withHelpRoute(
        `Expected an archive or chapter Wiki Graph URI: ${uri}`,
        helpRoute,
      ),
    );
  }
  if (parsed.objectUri === undefined) {
    return { archivePath: parsed.archivePath };
  }

  const chapterTarget = parseChapterTarget(parsed.objectUri);
  if (chapterTarget?.kind !== "chapter") {
    throw new Error(
      withHelpRoute(
        `Expected an archive or chapter Wiki Graph URI: ${uri}`,
        helpRoute,
      ),
    );
  }

  return {
    archivePath: parsed.archivePath,
    chapterId: chapterTarget.chapterId,
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
    rejectStreamingJSONFlag(action, values.json, helpRoute);
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
        `\`wg wikg://local/job/<job-id> ${action}\` requires <job-id>.`,
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
      `\`wg wikg://local/job ${action}\` does not support --jsonl.`,
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
      `\`wg wikg://local/job ${action}\` does not support ${name}.`,
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
            `Invalid chapter action: ${action}. Use the chapter collection URI directly, add --query, or use add, move, remove, reset, or tree. Use concrete chapter resource URIs such as /source, /summary, or /title for set operations.`,
            CLI_HELP_ROUTES.command,
          ),
        );
      }
      if (
        action === "set-source" ||
        action === "set-summary" ||
        action === "set-title"
      ) {
        throw new Error(
          withHelpRoute(
            `Invalid chapter action: ${action}. Use concrete chapter resource URIs such as /source, /summary, or /title for set operations.`,
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
  helpRoute = `wg ${action} --help`,
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
      rejectArchiveExtraPositionals(action, positionals, 1, helpRoute);
      rejectArchiveFlag(action, "--input", values.input, helpRoute);
      rejectArchiveFlag(
        action,
        "--input-format",
        values["input-format"],
        helpRoute,
      );
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
      rejectArchiveFlag(action, "--llm", values.llm, helpRoute);
      rejectArchiveFlag(action, "--prompt", values.prompt, helpRoute);
      rejectArchiveFlag(action, "--query", values.query, helpRoute);
      rejectArchiveBooleanFlag(action, "--reverse", values.reverse, helpRoute);
      rejectArchiveBooleanFlag(action, "--confirm", values.confirm, helpRoute);
      rejectArchiveBooleanFlag(action, "--jsonl", values.jsonl, helpRoute);
      if (
        values.import !== undefined &&
        inferCLIFormatFromPath(values.import) !== "epub"
      ) {
        throw new Error(
          withHelpRoute(
            "`create --import` only supports EPUB input.",
            helpRoute,
          ),
        );
      }
      return {
        args: {
          action,
          archivePath,
          ...(values.import === undefined ? {} : { importPath: values.import }),
          ...(values.json === undefined ? {} : { json: values.json }),
          ...(values.replace === undefined ? {} : { replace: values.replace }),
        },
        help: false,
        kind: "archive",
      };
    }
    case "export":
      rejectArchiveExtraPositionals(action, positionals, 1, helpRoute);
      rejectArchiveFlag(action, "--import", values.import, helpRoute);
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
    case "inspect": {
      const chapterId = parseArchiveInspectChapterId(positionals[0]);
      const parsedArchivePath =
        parseLocatedWikiGraphUri(archivePath).archivePath ?? archivePath;

      rejectArchiveExtraPositionals(action, positionals, 1, helpRoute);
      rejectArchiveNonReadFlags(action, values, helpRoute);
      rejectArchiveFlag(action, "--budget", values.budget, helpRoute);
      rejectArchiveFlag(action, "--chapter", values.chapter, helpRoute);
      rejectArchiveFlag(action, "--context", values.context, helpRoute);
      rejectArchiveFlag(action, "--cursor", values.cursor, helpRoute);
      rejectArchiveFlag(action, "--evidence", values.evidence, helpRoute);
      rejectArchiveFlag(action, "--from", values.from, helpRoute);
      rejectArchiveFlag(action, "--query", values.query, helpRoute);
      rejectArchiveFlag(action, "--stage", values.stage, helpRoute);
      rejectArchiveFlag(action, "--to", values.to, helpRoute);
      rejectArchiveBooleanFlag(action, "--all", values.all, helpRoute);
      rejectArchiveBooleanFlag(
        action,
        "--backlinks",
        values.backlinks,
        helpRoute,
      );
      rejectArchiveBooleanFlag(action, "--confirm", values.confirm, helpRoute);
      rejectArchiveBooleanFlag(action, "--jsonl", values.jsonl, helpRoute);
      rejectArchiveFlag(action, "--limit", values.limit, helpRoute);
      rejectArchiveFlag(action, "--role", values.role, helpRoute);
      return {
        args: {
          action,
          archivePath: parsedArchivePath,
          ...(chapterId === undefined ? {} : { chapterId }),
          ...(values.json === true ? { json: true } : {}),
        },
        help: false,
        kind: "archive",
      };
    }
    case "search": {
      const query = values.query;

      if (query === undefined) {
        throw new Error(
          withHelpRoute("Scope keyword retrieval requires --query.", helpRoute),
        );
      }
      rejectArchiveExtraPositionals(action, positionals, 1, helpRoute);
      rejectArchiveNonReadFlags(action, values, helpRoute);
      rejectArchiveFlag(action, "--budget", values.budget, helpRoute);
      rejectArchiveFlag(action, "--chapter", values.chapter, helpRoute);
      rejectArchiveFlag(action, "--from", values.from, helpRoute);
      rejectArchiveFlag(action, "--role", values.role, helpRoute);
      rejectArchiveBooleanFlag(action, "--reverse", values.reverse, helpRoute);
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
      rejectArchiveFlag(action, "--query", values.query, helpRoute);
      rejectArchiveReverseQuery(values, helpRoute);
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
          ...(values.reverse === true ? { reverse: true } : {}),
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
      rejectArchiveFlag(action, "--query", values.query, helpRoute);
      rejectArchiveReverseQuery(values, helpRoute);
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
          ...(values.reverse === true ? { reverse: true } : {}),
        },
        help: false,
        kind: "archive",
      };
    }
    case "related": {
      rejectArchiveExtraPositionals(action, positionals, 1, helpRoute);
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
      rejectArchiveReverseQuery(values, helpRoute);
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
          ...(values.query === undefined ? {} : { query: values.query }),
          ...(values.reverse === true ? { reverse: true } : {}),
          ...(relatedTarget === "entity"
            ? parseRelatedRoleFlag(values.role, helpRoute)
            : {}),
        },
        help: false,
        kind: "archive",
      };
    }
    case "evidence": {
      rejectArchiveExtraPositionals(action, positionals, 1, helpRoute);
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
      rejectArchiveReverseQuery(values, helpRoute);
      rejectArchiveBooleanFlag(action, "--confirm", values.confirm, helpRoute);
      validateEvidenceTargetUri(archivePath, helpRoute);
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
          ...(values.query === undefined ? {} : { query: values.query }),
          ...(values.reverse === true ? { reverse: true } : {}),
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
      rejectArchiveBooleanFlag(action, "--reverse", values.reverse, helpRoute);
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
      rejectArchiveBooleanFlag(action, "--reverse", values.reverse, helpRoute);
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
    action === "export" ||
    action === "inspect" ||
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

  if (!looksLikeWikgPath(value)) {
    return;
  }

  throw new Error(formatPathAsUriMessage(value));
}

function parseArchiveInspectChapterId(
  uri: string | undefined,
): number | undefined {
  if (uri === undefined || !isWikiGraphUri(uri)) {
    return undefined;
  }

  const objectUri = parseLocatedWikiGraphUri(uri).objectUri;
  const match =
    objectUri === undefined
      ? undefined
      : /^wikg:\/\/chapter\/([1-9][0-9]*)$/u.exec(objectUri);

  return match?.[1] === undefined ? undefined : Number(match[1]);
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
      withHelpRoute(formatPackObjectMismatchMessage(uri), CLI_HELP_ROUTES.uri),
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
        CLI_HELP_ROUTES.uri,
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

function validateEvidenceTargetUri(uri: string, helpRoute: string): void {
  const parsed = parseLocatedWikiGraphUri(uri);

  if (parsed.archivePath === undefined) {
    throw new Error(
      withHelpRoute(formatMissingArchiveLocatorMessage(uri), helpRoute),
    );
  }
  if (
    parsed.objectUri === undefined ||
    !isEvidenceObjectUri(parsed.objectUri)
  ) {
    throw new Error(
      withHelpRoute(
        `Evidence is only available for chunk, entity, and triple objects: ${uri}`,
        helpRoute,
      ),
    );
  }
}

function isEvidenceObjectUri(objectUri: string): boolean {
  return /^(?:chapter\/[1-9][0-9]*\/)?(?:chunk\/.+|entity\/.+|triple\/.+)$/u.test(
    stripObjectUriPrefix(objectUri),
  );
}

function isPackableObjectUri(objectUri: string): boolean {
  return (
    /^wikg:\/\/chunk\/[1-9][0-9]*$/u.test(objectUri) ||
    /^wikg:\/\/chapter\/[1-9][0-9]*\/chunk\/[1-9][0-9]*$/u.test(objectUri) ||
    /^wikg:\/\/entity\/[^/]+$/u.test(objectUri) ||
    /^wikg:\/\/chapter\/[1-9][0-9]*\/entity\/[^/]+$/u.test(objectUri)
  );
}

function getRelatedObjectUriType(
  objectUri: string,
): "chunk" | "entity" | undefined {
  if (
    /^wikg:\/\/chunk\/[1-9][0-9]*$/u.test(objectUri) ||
    /^wikg:\/\/chapter\/[1-9][0-9]*\/chunk\/[1-9][0-9]*$/u.test(objectUri)
  ) {
    return "chunk";
  }
  if (
    /^wikg:\/\/entity\/[^/]+$/u.test(objectUri) ||
    /^wikg:\/\/chapter\/[1-9][0-9]*\/entity\/[^/]+$/u.test(objectUri)
  ) {
    return "entity";
  }

  return undefined;
}

function formatUnknownCommandMessage(command: string): string {
  if (looksLikeWikgPath(command)) {
    return formatPathAsUriMessage(command);
  }

  return withHelpRoute(`Unknown command: ${command}.`, CLI_HELP_ROUTES.command);
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
    ? `wikg://${archivePath}${suffix}`
    : `wikg://${archivePath.replace(/^\.\/+/u, "")}${suffix}`;

  return [
    `Expected a Wiki Graph URI, not a filesystem path: ${path}`,
    `Use: ${uri}`,
    "See: wg help uri",
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
    "Example: wikg://book.wikg/entity/Q9957",
    "See: wg help uri",
  ].join("\n");
}

function formatPackObjectMismatchMessage(uri: string): string {
  return [
    `Pack requires a graph object URI: ${uri}`,
    "Supported pack targets are chunk and entity objects.",
    "Use `wg <uri> --help` to inspect valid predicates.",
  ].join("\n");
}

function formatMissingArchiveInputMessage(action: CLIArchiveAction): string {
  switch (action) {
    case "create":
      return "Missing archive URI. Use `wg wikg://<archive.wikg> create`.";
    case "export":
      return "Missing archive URI. Use `wg wikg://<archive.wikg> export --output-format <format>`.";
    case "inspect":
      return "Missing archive URI. Use `wg wikg://<archive.wikg> inspect`.";
    case "search":
      return "Missing scope URI with .wikg locator. Use `wg wikg://<archive.wikg> --query <query>`.";
    case "list":
      return "Missing scope URI with .wikg locator. Use `wg wikg://<archive.wikg>`.";
    case "get":
      return "Missing object URI with .wikg locator. Use `wg wikg://<archive.wikg>/<object>`.";
    case "related":
    case "evidence":
    case "pack":
      return `Missing object URI. Use \`wg wikg://<archive.wikg>/<object> ${action}\`.`;
    case "next":
      return "Missing continuation cursor. Use `wg next <cursor>`.";
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
    readonly import?: string;
    readonly input?: string;
    readonly "input-format"?: string;
    readonly json?: boolean;
    readonly "json-input"?: string;
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
  inputValue?: string,
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
      rejectActionFlag(values.import, "--import", action, helpRoute);
      rejectActionFlag(values.prompt, "--prompt", action, helpRoute);
      rejectActionFlag(values.stage, "--stage", action, helpRoute);
      rejectActionFlag(values.to, "--to", action, helpRoute);
      rejectActionBooleanFlag(
        values.recursive,
        "--recursive",
        action,
        helpRoute,
      );
      rejectActionFlag(
        values["input-format"],
        "--input-format",
        action,
        helpRoute,
      );
      return {
        action,
        path,
        ...(values.input === undefined ? {} : { inputPath: values.input }),
        ...(values.json === undefined ? {} : { json: values.json }),
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
      rejectActionFlag(values.import, "--import", action, helpRoute);
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
      rejectActionFlag(values["json-input"], "--json", action, helpRoute);
      rejectActionBooleanFlag(values.json, "--json", action, helpRoute);
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
      rejectActionFlag(values.import, "--import", action, helpRoute);
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
        ...(values.json === undefined ? {} : { json: values.json }),
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
      rejectActionFlag(values.import, "--import", action, helpRoute);
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
        ...(values.json === undefined ? {} : { json: values.json }),
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
      rejectActionFlag(values.import, "--import", action, helpRoute);
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
        ...(values.json === undefined ? {} : { json: values.json }),
        path,
        resetStage,
        ...(values.llm === undefined ? {} : { llmJSON: values.llm }),
      };
    case "set-source":
      requireChapterId(chapterId, action, helpRoute);
      rejectActionFlag(values.stage, "--stage", action, helpRoute);
      rejectActionFlag(values.after, "--after", action, helpRoute);
      rejectActionFlag(values.before, "--before", action, helpRoute);
      rejectActionFlag(values.import, "--import", action, helpRoute);
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
        ...(inputValue === undefined ? {} : { inputValue }),
        ...(values.json === undefined ? {} : { json: values.json }),
        path,
        ...(values.input === undefined ? {} : { inputPath: values.input }),
        ...(values.llm === undefined ? {} : { llmJSON: values.llm }),
      };
    case "set-summary":
      requireChapterId(chapterId, action, helpRoute);
      rejectActionFlag(values.stage, "--stage", action, helpRoute);
      rejectActionFlag(values.after, "--after", action, helpRoute);
      rejectActionFlag(values.before, "--before", action, helpRoute);
      rejectActionFlag(values.import, "--import", action, helpRoute);
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
      rejectActionFlag(values["json-input"], "--json", action, helpRoute);
      rejectActionBooleanFlag(values.json, "--json", action, helpRoute);
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
        ...(inputValue === undefined ? {} : { inputValue }),
        path,
        ...(values.input === undefined ? {} : { inputPath: values.input }),
        ...(values.llm === undefined ? {} : { llmJSON: values.llm }),
      };
    case "set-title":
      requireChapterId(chapterId, action, helpRoute);
      rejectActionFlag(values.stage, "--stage", action, helpRoute);
      rejectActionFlag(values.after, "--after", action, helpRoute);
      rejectActionFlag(values.before, "--before", action, helpRoute);
      rejectActionFlag(values.import, "--import", action, helpRoute);
      rejectActionFlag(values["json-input"], "--json", action, helpRoute);
      rejectActionBooleanFlag(values.json, "--json", action, helpRoute);
      if (values.title !== undefined) {
        throw new Error(
          withHelpRoute(
            "`chapter title set` uses a positional value instead of --title.",
            helpRoute,
          ),
        );
      }
      if (inputValue === undefined && values.clear !== true) {
        throw new Error(withHelpRoute("Missing title value.", helpRoute));
      }
      if (inputValue !== undefined && values.clear === true) {
        throw new Error(
          withHelpRoute(
            "`chapter title clear` cannot combine with a title value.",
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
        ...(inputValue === undefined ? {} : { title: inputValue }),
        ...(values.llm === undefined ? {} : { llmJSON: values.llm }),
      };
    case "tree":
      rejectActionFlag(values.stage, "--stage", action, helpRoute);
      rejectActionFlag(values.chapter, "--chapter", action, helpRoute);
      rejectActionFlag(values.after, "--after", action, helpRoute);
      rejectActionFlag(values.before, "--before", action, helpRoute);
      rejectActionFlag(values.import, "--import", action, helpRoute);
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
    readonly import?: string;
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
  rejectHelpFlag("import", values.import);
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

  if (positionals.length > 1) {
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

  if (isPublicArchiveCommandHelpAction(positionals[0])) {
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

  if (!isWikiGraphUri(normalized)) {
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
  const match = /^wikg:\/\/chapter\/([1-9][0-9]*)\/?$/u.exec(objectUri);

  if (match?.[1] === undefined) {
    throw new Error(
      withHelpRoute(
        `Invalid ${flag}: ${value}. Expected a chapter URI such as wikg://chapter/3.`,
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
  rejectCommandMetaFlags(values, "help", CLI_HELP_ROUTES.root);
}

function rejectNonGcForceFlag(
  positionals: readonly string[],
  values: ArchiveArgumentValues,
): void {
  if (values.force !== true || positionals[0] === "gc") {
    return;
  }

  throw new Error(
    withHelpRoute(
      "The --force option is only supported by `gc`.",
      CLI_HELP_ROUTES.root,
    ),
  );
}

function rejectNonCreateReplaceFlag(
  positionals: readonly string[],
  values: ArchiveArgumentValues,
): void {
  if (values.replace !== true) {
    return;
  }

  const [command, action] = positionals;
  if (
    command?.startsWith(WIKI_GRAPH_URI_PREFIX) === true &&
    action === "create"
  ) {
    return;
  }

  throw new Error(
    withHelpRoute(
      "The --replace option is only supported by `wg <archive-uri> create`.",
      CLI_HELP_ROUTES.root,
    ),
  );
}

function rejectGcMetaFlags(values: ArchiveMetaFlagValues): void {
  rejectCommandMetaFlags(values, "gc", "wg gc --help");
}

function rejectCommandMetaFlags(
  values: ArchiveMetaFlagValues,
  command: string,
  helpRoute: string,
): void {
  for (const flag of listPresentMetaFlags(values)) {
    throw new Error(
      withHelpRoute(
        `The \`${command}\` command does not support ${flag}.`,
        helpRoute,
      ),
    );
  }
}

function rejectGcFlag(
  name: string,
  value: string | boolean | readonly string[] | undefined,
  helpRoute: string,
): void {
  if (value === undefined || value === false) {
    return;
  }

  throw new Error(
    withHelpRoute(`The \`gc\` command does not support --${name}.`, helpRoute),
  );
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
        "wg transform --help",
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

function isArchiveAction(value: string | undefined): value is CLIArchiveAction {
  return (
    value === "create" ||
    value === "evidence" ||
    value === "export" ||
    value === "get" ||
    value === "inspect" ||
    value === "list" ||
    value === "next" ||
    value === "pack" ||
    value === "related" ||
    value === "search"
  );
}

function isPublicArchiveCommandHelpAction(
  value: string | undefined,
): value is "next" {
  return value === "next";
}

function isRemovedImplicitArchiveAction(
  value: string | undefined,
): value is "get" | "list" | "search" {
  return value === "get" || value === "list" || value === "search";
}

function formatRemovedImplicitVerbMessage(
  _action: "get" | "list" | "search",
): string {
  return withHelpRoute(
    "This command form is not available. Pass the URI directly, or add --query to a scope URI.",
    CLI_HELP_ROUTES.uri,
  );
}

function isArchiveUriAction(
  value: string | undefined,
): value is CLIArchiveUriAction {
  return (
    isArchiveAction(value) ||
    isArchiveChapterAction(value) ||
    isArchiveIndexAction(value) ||
    isMetadataAction(value)
  );
}

function isArchiveIndexAction(
  value: string | undefined,
): value is CLIArchiveIndexAction {
  return (
    value === "disable" ||
    value === "embed" ||
    value === "enable" ||
    value === "external" ||
    value === "get"
  );
}

function isMetadataAction(
  value: string | undefined,
): value is CLIMetadataAction {
  return (
    value === "clear" ||
    value === "delete" ||
    value === "get" ||
    value === "put" ||
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

function isImplicitArchiveReadAction(
  value: CLIArchiveUriAction,
): value is "get" | "list" | "search" {
  return value === "get" || value === "list" || value === "search";
}

function isWikiGraphUri(value: string | undefined): boolean {
  return value?.startsWith(WIKI_GRAPH_URI_PREFIX) === true;
}

function stripObjectUriPrefix(objectUri: string): string {
  const prefix = getWikiGraphUriPrefix(objectUri);

  if (prefix === undefined) {
    throw new Error(`Expected Wiki Graph object URI: ${objectUri}`);
  }

  return objectUri.slice(prefix.length).replace(/^\/+|\/+$/gu, "");
}

function isWikiGraphJobUri(value: string | undefined): boolean {
  return isWikiGraphLocalJobUri(value);
}

function isWikiGraphLocalConfigUri(value: string | undefined): boolean {
  return (
    value === `${WIKI_GRAPH_URI_PREFIX}local/config` ||
    value?.startsWith(`${WIKI_GRAPH_URI_PREFIX}local/config/`) === true
  );
}

function parseLocalConfigUriSection(
  uri: string,
): LocalConfigSection | undefined {
  const prefix = `${WIKI_GRAPH_URI_PREFIX}local/config/`;

  if (!uri.startsWith(prefix)) {
    return undefined;
  }

  const [section] = uri.slice(prefix.length).split("/");

  return parseLocalConfigSection(section);
}

function parseWikiGraphJobUri(uri: string): string | undefined {
  const body = parseWikiGraphJobUriBody(uri);

  if (body === undefined) {
    throw new Error(
      withHelpRoute(
        `Expected a Wiki Graph job URI: ${uri}`,
        "wg wikg://local/job --help",
      ),
    );
  }

  const jobId = stripLeadingSlash(body).trim();
  if (jobId === "") {
    return undefined;
  }

  return jobId;
}

function parseWikiGraphJobTargetUri(
  uri: string | undefined,
): string | undefined {
  if (uri === undefined) {
    return undefined;
  }

  const body = parseWikiGraphJobUriBody(uri);
  if (body === undefined) {
    return undefined;
  }
  if (!body.endsWith("/target")) {
    return undefined;
  }

  const jobId = stripLeadingSlash(body.slice(0, -"/target".length)).trim();
  if (jobId === "") {
    throw new Error(
      withHelpRoute(
        `Expected a job id before /target: ${uri}`,
        "wg wikg://local/job/<job-id>/target set --help",
      ),
    );
  }

  return jobId;
}

function getWikiGraphUriPrefix(uri: string): string | undefined {
  if (uri.startsWith(WIKI_GRAPH_URI_PREFIX)) {
    return WIKI_GRAPH_URI_PREFIX;
  }

  return undefined;
}

function isWikiGraphLocalJobUri(value: string | undefined): boolean {
  return (
    value === WIKI_GRAPH_JOB_URI_PREFIX ||
    value?.startsWith(`${WIKI_GRAPH_JOB_URI_PREFIX}/`) === true
  );
}

function parseWikiGraphJobUriBody(uri: string): string | undefined {
  if (uri === WIKI_GRAPH_JOB_URI_PREFIX) {
    return "";
  }
  if (uri.startsWith(`${WIKI_GRAPH_JOB_URI_PREFIX}/`)) {
    return uri.slice(WIKI_GRAPH_JOB_URI_PREFIX.length);
  }

  return undefined;
}

function stripLeadingSlash(value: string): string {
  return value.replace(/^\/+/u, "");
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
    value === "add" ||
    value === "boost" ||
    value === "cancel" ||
    value === "clean" ||
    value === "get" ||
    value === "list" ||
    value === "pause" ||
    value === "resume" ||
    value === "set" ||
    value === "watch"
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
          "wg wikg://local/job add --help",
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

function rejectArchiveReverseQuery(
  values: Pick<ArchiveArgumentValues, "query" | "reverse">,
  helpRoute: string,
): void {
  if (values.query !== undefined && values.reverse === true) {
    throw new Error(
      withHelpRoute("`--reverse` cannot be combined with --query.", helpRoute),
    );
  }
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
      case "--reverse":
        normalizedValues[item.slice(2)] = true;
        continue;
      case "--budget":
      case "--chapter":
      case "--context":
      case "--cursor":
      case "--import":
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
  const jsonMayTakeValue = isValueInputJsonFlagContext(argv);

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

    if (item.startsWith("--json=") && jsonMayTakeValue) {
      normalized.push("--json");
      normalized.push(`--json-input=${item.slice("--json=".length)}`);
      continue;
    }

    if (item === "--json" && jsonMayTakeValue) {
      const value = argv[index + 1];

      normalized.push(item);
      if (value !== undefined && !value.startsWith("-")) {
        normalized.push("--json-input");
        normalized.push(value);
        index += 1;
      }
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

function isValueInputJsonFlagContext(argv: readonly string[]): boolean {
  const first = argv[0];
  const second = argv[1];

  if (second !== "set" && second !== "put") {
    return false;
  }
  if (isWikiGraphLocalConfigUri(first)) {
    return true;
  }

  return (
    isWikiGraphUri(first) &&
    argv.some((item) => item.includes("/meta") || item.endsWith(".wikg/meta"))
  );
}

function rejectArchiveExtraPositionals(
  action: string,
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
        "wg cover --help",
      ),
    );
  }
}

function rejectArchiveFlag(
  action: string,
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
  action: string,
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
  action: string,
  values: {
    readonly input?: string;
    readonly import?: string;
    readonly "input-format"?: string;
    readonly llm?: string;
    readonly output?: string;
    readonly "output-format"?: string;
    readonly prompt?: string;
  },
  helpRoute: string,
): void {
  rejectArchiveFlag(action, "--input", values.input, helpRoute);
  rejectArchiveFlag(action, "--import", values.import, helpRoute);
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

function formatWikiGraphHelpCommand(uri: string, action?: string): string {
  return formatCliCommand([
    uri,
    ...(action === undefined ? [] : [action]),
    "--help",
  ]);
}
