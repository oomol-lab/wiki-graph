import {
  formatLocatedChapterResourceUri,
  formatLocatedChapterSourceCollectionUri,
  formatLocatedChapterUri,
  parseLocatedWikiGraphUri,
  type ArchiveTriplePattern,
} from "wiki-graph-core";
import { CLI_HELP_ROUTES, withHelpRoute } from "../support/index.js";
import {
  isUriHelpPredicate,
  renderArchiveMaintenanceChapterActionHelpText,
  renderArchiveMaintenanceCommandHelpText,
  renderUriHelpText,
  renderUriPredicateHelpText,
  type UriHelpTargetName,
} from "../help.js";
import { parseArchiveArguments } from "./archive.js";
import type {
  ArchiveArgumentValues,
  ArchiveUriLens,
  ChapterStateUriTarget,
  CLIArchiveChapterAction,
  CLIArchiveUriAction,
  CLIMetadataAction,
  ParsedCLIArguments,
} from "./types.js";
import {
  formatMissingArchiveLocatorMessage,
  formatRemovedImplicitVerbMessage,
  formatWikiGraphHelpCommand,
  isArchiveAction,
  isArchiveIndexAction,
  isArchiveUriAction,
  isImplicitArchiveReadAction,
  isMetadataAction,
  isRemovedImplicitArchiveAction,
  isUriFirstArchiveAction,
  normalizeArchiveChapterArguments,
  rejectArchiveBooleanFlag,
  rejectArchiveChapterFlag,
  rejectArchiveChapterMetaFlags,
  rejectArchiveExtraPositionals,
  rejectArchiveFlag,
  rejectArchiveMaintenanceExtraPositionals,
  rejectArchiveNonReadFlags,
  rejectCommandMetaFlags,
  rejectCoverCommandBooleanFlag,
  rejectCoverCommandFlag,
  rejectCoverMetaFlags,
  rejectMetaCommandBooleanFlag,
  rejectMetaCommandFlag,
  rejectStreamingJSONFlag,
  stripObjectUriPrefix,
} from "./helpers.js";

export function parseArchiveUriFirstArguments(
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

export type ChapterUriTarget =
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

export function parseChapterTarget(
  objectUri: string,
): ChapterUriTarget | undefined {
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
