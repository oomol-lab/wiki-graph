import { CLI_HELP_ROUTES, withHelpRoute } from "../support/index.js";
import { formatCliCommand } from "../support/index.js";
import {
  parseLocalConfigSection,
  type LocalConfigSection,
} from "../local-config-store.js";
import {
  parseLocatedWikiGraphUri,
  WIKI_GRAPH_JOB_URI_PREFIX,
  WIKI_GRAPH_URI_PREFIX,
  type BuildJobTarget,
  type ChapterStage,
} from "wiki-graph-core";
import type {
  ArchiveArgumentValues,
  ArchiveMetaFlagValues,
  CLIArchiveAction,
  CLIArchiveChapterAction,
  CLIArchiveChapterArguments,
  CLIArchiveIndexAction,
  CLIArchiveMaintenanceCommand,
  CLIArchiveUriAction,
  CLIJobAction,
  CLIMetadataAction,
  CLIQueueAction,
  CLIResultFormat,
} from "./types.js";

export function validateArchiveCommandUriInput(
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

export function parseArchiveInspectChapterId(
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

export function validatePackTargetUri(uri: string, helpRoute: string): void {
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

export function validateRelatedTargetUri(
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

export function validateEvidenceTargetUri(
  uri: string,
  helpRoute: string,
): void {
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

export function isEvidenceObjectUri(objectUri: string): boolean {
  return /^(?:chapter\/[1-9][0-9]*\/)?(?:chunk\/.+|entity\/.+|triple\/.+)$/u.test(
    stripObjectUriPrefix(objectUri),
  );
}

export function isPackableObjectUri(objectUri: string): boolean {
  return (
    /^wikg:\/\/chunk\/[1-9][0-9]*$/u.test(objectUri) ||
    /^wikg:\/\/chapter\/[1-9][0-9]*\/chunk\/[1-9][0-9]*$/u.test(objectUri) ||
    /^wikg:\/\/entity\/[^/]+$/u.test(objectUri) ||
    /^wikg:\/\/chapter\/[1-9][0-9]*\/entity\/[^/]+$/u.test(objectUri)
  );
}

export function getRelatedObjectUriType(
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

export function formatUnknownCommandMessage(command: string): string {
  if (looksLikeWikgPath(command)) {
    return formatPathAsUriMessage(command);
  }

  return withHelpRoute(`Unknown command: ${command}.`, CLI_HELP_ROUTES.command);
}

export function looksLikeWikgPath(value: string): boolean {
  const normalized = normalizeWikgPathSeparators(value);

  return (
    normalized.endsWith(".wikg") ||
    normalized.includes(".wikg/") ||
    normalized.includes(".wikg#")
  );
}

export function formatPathAsUriMessage(path: string): string {
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

export function splitWikgPath(path: string): readonly [string, string] {
  const archiveEnd = path.indexOf(".wikg") + ".wikg".length;

  return [path.slice(0, archiveEnd), path.slice(archiveEnd)];
}

export function normalizeWikgPathSeparators(path: string): string {
  return path.replace(/\\/gu, "/");
}

export function formatMissingArchiveLocatorMessage(uri: string): string {
  return [
    `Expected a located Wiki Graph URI with a .wikg archive locator: ${uri}`,
    "Short object URIs from output are archive-relative handles.",
    "Example: wikg://book.wikg/entity/Q9957",
    "See: wg help uri",
  ].join("\n");
}

export function formatPackObjectMismatchMessage(uri: string): string {
  return [
    `Pack requires a graph object URI: ${uri}`,
    "Supported pack targets are chunk and entity objects.",
    "Use `wg <uri> --help` to inspect valid predicates.",
  ].join("\n");
}

export function formatMissingArchiveInputMessage(
  action: CLIArchiveAction,
): string {
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

export function normalizeArchiveChapterArguments(
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

export function parseSerialId(
  value: string,
  flag: string,
  helpRoute: string,
): number {
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

export function parseChapterRef(
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

export function isArchiveChapterAction(
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

export function isArchiveMaintenanceCommand(
  value: string | undefined,
): value is CLIArchiveMaintenanceCommand {
  return value === "chapter" || value === "cover" || value === "meta";
}

export function parseChapterStage(
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

export function parseResetStage(
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

export function parseExternalChapterStage(
  value: string,
): ChapterStage | undefined {
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

export function rejectActionFlag(
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

export function rejectActionBooleanFlag(
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

export function rejectConflictingMoveFlags(
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

export function rejectArchiveChapterFlag(
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

export function rejectArchiveChapterMetaFlags(
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

export function rejectHelpMetaFlags(values: ArchiveMetaFlagValues): void {
  rejectCommandMetaFlags(values, "help", CLI_HELP_ROUTES.root);
}

export function rejectNonGcForceFlag(
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

export function rejectNonCreateReplaceFlag(
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

export function rejectGcMetaFlags(values: ArchiveMetaFlagValues): void {
  rejectCommandMetaFlags(values, "gc", "wg gc --help");
}

export function rejectCommandMetaFlags(
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

export function rejectGcFlag(
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

export function rejectTransformFlag(
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

export function rejectTransformMetaFlags(values: ArchiveMetaFlagValues): void {
  for (const flag of listPresentMetaFlags(values)) {
    throw new Error(
      withHelpRoute(
        `The \`transform\` command does not support ${flag}.`,
        "wg transform --help",
      ),
    );
  }
}

export function listPresentMetaFlags(
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

export function requireChapterId(
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

export function rejectHelpFlag(
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

export function isArchiveAction(
  value: string | undefined,
): value is CLIArchiveAction {
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

export function isPublicArchiveCommandHelpAction(
  value: string | undefined,
): value is "next" {
  return value === "next";
}

export function isRemovedImplicitArchiveAction(
  value: string | undefined,
): value is "get" | "list" | "search" {
  return value === "get" || value === "list" || value === "search";
}

export function formatRemovedImplicitVerbMessage(
  _action: "get" | "list" | "search",
): string {
  return withHelpRoute(
    "This command form is not available. Pass the URI directly, or add --query to a scope URI.",
    CLI_HELP_ROUTES.uri,
  );
}

export function isArchiveUriAction(
  value: string | undefined,
): value is CLIArchiveUriAction {
  return (
    isArchiveAction(value) ||
    isArchiveChapterAction(value) ||
    isArchiveIndexAction(value) ||
    isMetadataAction(value)
  );
}

export function isArchiveIndexAction(
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

export function isMetadataAction(
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

export function isUriFirstArchiveAction(
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

export function isImplicitArchiveReadAction(
  value: CLIArchiveUriAction,
): value is "get" | "list" | "search" {
  return value === "get" || value === "list" || value === "search";
}

export function isWikiGraphUri(value: string | undefined): boolean {
  return value?.startsWith(WIKI_GRAPH_URI_PREFIX) === true;
}

export function stripObjectUriPrefix(objectUri: string): string {
  const prefix = getWikiGraphUriPrefix(objectUri);

  if (prefix === undefined) {
    throw new Error(`Expected Wiki Graph object URI: ${objectUri}`);
  }

  return objectUri.slice(prefix.length).replace(/^\/+|\/+$/gu, "");
}

export function isWikiGraphJobUri(value: string | undefined): boolean {
  return isWikiGraphLocalJobUri(value);
}

export function isWikiGraphLocalConfigUri(value: string | undefined): boolean {
  return (
    value === `${WIKI_GRAPH_URI_PREFIX}local/config` ||
    value?.startsWith(`${WIKI_GRAPH_URI_PREFIX}local/config/`) === true
  );
}

export function parseLocalConfigUriSection(
  uri: string,
): LocalConfigSection | undefined {
  const prefix = `${WIKI_GRAPH_URI_PREFIX}local/config/`;

  if (!uri.startsWith(prefix)) {
    return undefined;
  }

  const [section] = uri.slice(prefix.length).split("/");

  return parseLocalConfigSection(section);
}

export function parseWikiGraphJobUri(uri: string): string | undefined {
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

export function parseWikiGraphJobTargetUri(
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

export function getWikiGraphUriPrefix(uri: string): string | undefined {
  if (uri.startsWith(WIKI_GRAPH_URI_PREFIX)) {
    return WIKI_GRAPH_URI_PREFIX;
  }

  return undefined;
}

export function isWikiGraphLocalJobUri(value: string | undefined): boolean {
  return (
    value === WIKI_GRAPH_JOB_URI_PREFIX ||
    value?.startsWith(`${WIKI_GRAPH_JOB_URI_PREFIX}/`) === true
  );
}

export function parseWikiGraphJobUriBody(uri: string): string | undefined {
  if (uri === WIKI_GRAPH_JOB_URI_PREFIX) {
    return "";
  }
  if (uri.startsWith(`${WIKI_GRAPH_JOB_URI_PREFIX}/`)) {
    return uri.slice(WIKI_GRAPH_JOB_URI_PREFIX.length);
  }

  return undefined;
}

export function stripLeadingSlash(value: string): string {
  return value.replace(/^\/+/u, "");
}

export function requireArchiveUriPath(uri: string, helpRoute: string): string {
  const parsed = parseLocatedWikiGraphUri(uri);

  if (parsed.archivePath === undefined || parsed.objectUri !== undefined) {
    throw new Error(
      withHelpRoute(`Expected an archive Wiki Graph URI: ${uri}`, helpRoute),
    );
  }

  return parsed.archivePath;
}

export function isJobUriAction(
  value: string | undefined,
): value is CLIJobAction {
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

export function parseBuildJobTarget(value: string | undefined): BuildJobTarget {
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

export function parseWatchFrom(
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

export function parseResultFormat(values: {
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

export function parseEvidenceFlag(
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

export function parseSourceContextFlag(
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

export function rejectArchiveReverseQuery(
  values: Pick<ArchiveArgumentValues, "query" | "reverse">,
  helpRoute: string,
): void {
  if (values.query !== undefined && values.reverse === true) {
    throw new Error(
      withHelpRoute("`--reverse` cannot be combined with --query.", helpRoute),
    );
  }
}

export function parseRelatedRoleFlag(
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

export function parseNonNegativeIntegerFlag(
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

export function parsePositiveIntegerFlag(
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

export function normalizeArchiveInlineOptions(
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

export function normalizeArchiveValueFlagArgv(
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

export function isValueInputJsonFlagContext(argv: readonly string[]): boolean {
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

export function rejectArchiveExtraPositionals(
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

export function rejectQueueExtraPositionals(
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

export function rejectArchiveMaintenanceExtraPositionals(
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

export function rejectMetaCommandFlag(
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

export function rejectMetaCommandBooleanFlag(
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

export function rejectCoverCommandFlag(
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

export function rejectCoverCommandBooleanFlag(
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

export function rejectCoverMetaFlags(values: ArchiveMetaFlagValues): void {
  for (const flag of listPresentMetaFlags(values)) {
    throw new Error(
      withHelpRoute(
        `The \`cover\` command does not support ${flag}.`,
        "wg cover --help",
      ),
    );
  }
}

export function rejectArchiveFlag(
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

export function rejectArchiveBooleanFlag(
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

export function rejectStreamingJSONFlag(
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

export function rejectArchiveNonReadFlags(
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

export function formatWikiGraphHelpCommand(
  uri: string,
  action?: string,
): string {
  return formatCliCommand([
    uri,
    ...(action === undefined ? [] : [action]),
    "--help",
  ]);
}
