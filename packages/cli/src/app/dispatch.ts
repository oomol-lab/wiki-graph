import { renderMainHelpText } from "../args/help.js";
import { parseCLIArguments } from "../args/index.js";
import {
  runArchiveChapterCommand,
  runArchiveCommand,
  runArchiveCoverCommand,
  runArchiveIndexCommand,
  runArchiveMetaCommand,
  runConvertCommand,
  runGcCommand,
  runLegacyCommand,
  runLibraryCommand,
  runLocalConfigCommand,
  runMaintenanceCommand,
  runObjectMetadataCommand,
  runQueueCommand,
} from "../commands/index.js";
import {
  formatCLIJSON,
  formatCLIJSONLine,
  getRelativeArchiveUriResolution,
} from "../support/index.js";
import { readCLIVersion } from "../support/index.js";
import { isWikiGraphHomeTarget } from "../runtime/home-target.js";
import {
  ensureWikiGraphHomeSchemaCurrent,
  formatError,
  LLMPaymentRequiredError,
  WikiGraphError,
} from "wiki-graph-sdk";

export interface WikiGraphCLIDispatchInput {
  readonly argv: readonly string[];
  readonly stdinIsTTY?: boolean | undefined;
  readonly stderr: NodeJS.WritableStream;
  readonly stdout: NodeJS.WritableStream;
}

export interface WikiGraphCLIDispatchResult {
  readonly exitCode: number;
}

export async function dispatchWikiGraphCLI(
  input: WikiGraphCLIDispatchInput,
): Promise<WikiGraphCLIDispatchResult> {
  try {
    if (shouldPrintDefaultHelp(input.argv, input.stdinIsTTY)) {
      input.stdout.write(`${renderMainHelpText()}\n`);
      return { exitCode: 0 };
    }

    const parsed = parseCLIArguments([...input.argv]);

    if (parsed.help) {
      input.stdout.write(`${parsed.helpText}\n`);
      return { exitCode: 0 };
    }

    switch (parsed.kind) {
      case "version":
        input.stdout.write(`${readCLIVersion()}\n`);
        return { exitCode: 0 };
    }

    if (
      parsed.kind !== "maintenance-command" ||
      !isWikiGraphHomeTarget(parsed.args.target)
    ) {
      await ensureWikiGraphHomeSchemaCurrent();
    }

    switch (parsed.kind) {
      case "convert":
        await runConvertCommand(parsed.args);
        return { exitCode: 0 };
      case "meta":
        await runArchiveMetaCommand(parsed.args);
        return { exitCode: 0 };
      case "cover":
        await runArchiveCoverCommand(parsed.args);
        return { exitCode: 0 };
      case "object-metadata":
        await runObjectMetadataCommand(parsed.args);
        return { exitCode: 0 };
      case "library":
        await runLibraryCommand(parsed.args);
        return { exitCode: 0 };
      case "chapter":
        await runArchiveChapterCommand(parsed.args);
        return { exitCode: 0 };
      case "archive":
        await runArchiveCommand(parsed.args);
        return { exitCode: 0 };
      case "archive-index":
        await runArchiveIndexCommand(parsed.args);
        return { exitCode: 0 };
      case "queue":
        await runQueueCommand(parsed.args);
        return { exitCode: 0 };
      case "gc":
        await runGcCommand(parsed.args);
        return { exitCode: 0 };
      case "legacy":
        await runLegacyCommand(parsed.args);
        return { exitCode: 0 };
      case "maintenance-command":
        await runMaintenanceCommand(parsed.args);
        return { exitCode: 0 };
      case "local-config":
        await runLocalConfigCommand(parsed.args);
        return { exitCode: 0 };
    }
  } catch (error) {
    if (shouldWriteJSONError(input.argv)) {
      input.stdout.write(
        formatCLIJSON(createCLIErrorObject(error, input.argv)),
      );
      return { exitCode: 1 };
    }
    if (shouldWriteJSONLError(input.argv)) {
      input.stdout.write(
        formatCLIJSONLine(createCLIErrorObject(error, input.argv)),
      );
      return { exitCode: 1 };
    }
    input.stderr.write(`${formatCLIError(error, input.argv)}\n`);
    return { exitCode: 1 };
  }
}

function shouldPrintDefaultHelp(
  argv: readonly string[],
  stdinIsTTY: boolean | undefined,
): boolean {
  return argv.length === 0 && stdinIsTTY === true;
}

function formatCLIError(error: unknown, argv: readonly string[]): string {
  if (error instanceof LLMPaymentRequiredError) {
    return "LLM payment required. Check your provider billing status or account balance.";
  }

  const message = formatTerminalRemediation(error, formatError(error));
  const relativeResolution = hasErrorCode(error, "ENOENT")
    ? getRelativeArchiveUriResolution(argv[0] ?? "")
    : undefined;
  if (relativeResolution === undefined) {
    return message;
  }

  return `${message}\nArchive URI \`${relativeResolution.inputUri}\` is relative to the current working directory:\n  ${relativeResolution.workingDirectory}\nResolved archive path:\n  ${relativeResolution.resolvedArchivePath}\nSee: wg help uri`;
}

function formatTerminalRemediation(error: unknown, message: string): string {
  if (error instanceof WikiGraphError) {
    const chapterId = error.details.chapterId;
    switch (error.code) {
      case "chapter_has_children":
        return `${message} Use --recursive to remove it and its descendants.`;
      case "chapter_key_missing":
        return "Missing chapter key in TOC. Run a writable chapter operation or `wg maintenance upgrade` before using read-only chapter paths.";
      case "chapter_not_found_ids":
        return `${message} Use \`wg <archive-uri>/chapter list\` to discover chapter ids.`;
      case "chapter_not_found_uris":
        return `${message} Use \`wg <archive-uri>/chapter\` to discover chapter URIs.`;
      case "parent_chapter_not_found":
        return `${message} Use \`wg <archive-uri>/chapter\` to discover chapter URIs.`;
      case "chapter_summary_missing_source":
        return `${message} Run \`wg wikg://local/job add --input <chapter-uri> --task reading-summary --accept-cost\` before export, or inspect the chapter with \`wg <archive-uri>/chapter/${chapterId}/source get\`.`;
      case "chapter_summary_missing_tree":
        return `${message} Run \`wg wikg://local/job add --input <chapter-uri> --task reading-summary --accept-cost\` before export, or inspect the archive with \`wg <archive-uri>/chapter/tree get\`.`;
      case "graph_node_not_found":
        return `${message} Use \`wg <archive-uri>/chapter/${chapterId}/chunk list\` to discover chunk ids.`;
      case "home_upgrade_blocked":
        return `${message} Stop the active operation, then run \`wg maintenance upgrade home\`. See: \`wg maintenance upgrade --help\`.`;
      case "library_query_unindexed":
        return `${message} Build missing chapter index artifacts, or rerun with --skip-unindexed to search indexed chapters only.`;
      case "summary_not_completed":
        return `${message} Use \`wg wikg://<archive.wikg>/chapter list\` to discover chapter ids, then \`wg wikg://<archive.wikg>/chapter/${chapterId}/summary get\` after summary is ready.`;
      case "uri_expected":
        break;
    }
  }

  if (
    message.startsWith(
      "Expected a Wiki Graph URI with a .wikg archive locator:",
    ) &&
    message.includes("\nExample:")
  ) {
    return `${message}\nSee: wg help uri`;
  }
  const roleMatch =
    /^Role filtering is only available for related entities: (.+)$/u.exec(
      message,
    );
  return roleMatch === null
    ? message
    : `--role is only available for entity related: ${roleMatch[1]}`;
}

function createCLIErrorObject(
  error: unknown,
  argv: readonly string[],
): {
  readonly error: {
    readonly message: string;
    readonly type: string;
  };
} {
  return {
    error: {
      message: formatCLIError(error, argv),
      type:
        error instanceof LLMPaymentRequiredError
          ? "llm_payment_required"
          : "error",
    },
  };
}

function hasErrorCode(error: unknown, code: string): boolean {
  const visited = new Set<unknown>();
  let current: unknown = error;

  while (current !== undefined && !visited.has(current)) {
    visited.add(current);
    if (
      current instanceof Error &&
      "code" in current &&
      (current as Error & { readonly code?: unknown }).code === code
    ) {
      return true;
    }
    current = current instanceof Error ? current.cause : undefined;
  }

  return false;
}

function shouldWriteJSONError(argv: readonly string[]): boolean {
  return argv.some((item) => item === "--json" || item.startsWith("--json="));
}

function shouldWriteJSONLError(argv: readonly string[]): boolean {
  return argv.includes("--jsonl");
}
