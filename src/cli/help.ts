import { resolveDataDirPath } from "../common/data-dir.js";
import { createEnv } from "../common/template.js";

import { CLI_FORMATS } from "./formats.js";
import { CLI_HELP_ROUTES, withHelpRoute } from "./errors.js";
import type {
  CLIArchiveAction,
  CLIArchiveChapterAction,
  CLIArchiveMaintenanceCommand,
  CLIQueueAction,
} from "./args.js";

export const HELP_TOPICS = [
  "overview",
  "task",
  "command",
  "object",
  "verb",
  "matrix",
  "format",
  "config",
  "env",
  "config-file",
  "runtime",
  "uri",
  "recipe",
  "troubleshoot",
  "ai",
] as const;

export type HelpTopic = (typeof HELP_TOPICS)[number];

export type HelpObjectName =
  | "archive"
  | "chapter"
  | "chapter-source"
  | "chapter-summary"
  | "chapter-title"
  | "chapter-tree"
  | "chapter-state"
  | "chunk"
  | "cover"
  | "cursor"
  | "entity"
  | "job"
  | "job-collection"
  | "source"
  | "summary"
  | "triple";

export type HelpVerbName =
  | "add"
  | "boost"
  | "cancel"
  | "create"
  | "estimate"
  | "evidence"
  | "export"
  | "get"
  | "list"
  | "move"
  | "next"
  | "pack"
  | "pause"
  | "queue"
  | "related"
  | "remove"
  | "reset"
  | "resume"
  | "search"
  | "set"
  | "watch";

interface HelpObjectVerb {
  readonly command: string;
  readonly note: string;
  readonly verb: HelpVerbName;
}

interface HelpObjectEntry {
  readonly aliases?: readonly string[];
  readonly description: string;
  readonly name: HelpObjectName;
  readonly title: string;
  readonly uriForms: readonly string[];
  readonly verbs: readonly HelpObjectVerb[];
}

interface HelpVerbEntry {
  readonly description: string;
  readonly name: HelpVerbName;
  readonly title: string;
}

interface HelpVerbObjectRows {
  readonly object: HelpObjectEntry;
  readonly rows: readonly HelpObjectVerb[];
}

interface HelpVerbView extends HelpVerbEntry {
  readonly objects: readonly HelpVerbObjectRows[];
}

export type HelpMatrixPage =
  | { readonly kind: "matrix" }
  | { readonly kind: "object"; readonly object?: HelpObjectName }
  | { readonly kind: "verb"; readonly verb?: HelpVerbName };

const HELP_OBJECTS: readonly HelpObjectEntry[] = [
  {
    description: "The whole `.wikg` archive addressed by its archive URI.",
    name: "archive",
    title: "Archive",
    uriForms: ["wkg://book.wikg", "wkg:///Users/me/book.wikg"],
    verbs: [
      {
        command: "wikigraph wkg://book.wikg get --json",
        note: "Read archive metadata as an object.",
        verb: "get",
      },
      {
        command: 'wikigraph wkg://book.wikg set --title "New Title"',
        note: "Edit archive metadata fields.",
        verb: "set",
      },
      {
        command: "wikigraph wkg://book.wikg create ./book.md",
        note: "Create or replace the archive from source material.",
        verb: "create",
      },
      {
        command: "wikigraph wkg://book.wikg estimate --stage reading-summary",
        note: "Estimate generated work before queueing it.",
        verb: "estimate",
      },
      {
        command: "wikigraph wkg://book.wikg export --output-format markdown",
        note: "Export a projection from the archive.",
        verb: "export",
      },
      {
        command: 'wikigraph wkg://book.wikg search "keyword"',
        note: "Search the whole archive.",
        verb: "search",
      },
      {
        command: "wikigraph wkg://book.wikg/chapter list",
        note: "List archive-level object collections.",
        verb: "list",
      },
    ],
  },
  {
    description: "The raw cover resource stored in an archive.",
    name: "cover",
    title: "Cover",
    uriForms: ["wkg://book.wikg/cover"],
    verbs: [
      {
        command: "wikigraph wkg://book.wikg/cover get > cover.bin",
        note: "Write cover bytes to stdout.",
        verb: "get",
      },
    ],
  },
  {
    aliases: ["chapters"],
    description: "The chapter collection under one archive.",
    name: "chapter",
    title: "Chapter Collection And Chapter",
    uriForms: ["wkg://book.wikg/chapter", "wkg://book.wikg/chapter/12"],
    verbs: [
      {
        command: "wikigraph wkg://book.wikg/chapter list",
        note: "List chapters in tree order.",
        verb: "list",
      },
      {
        command: "wikigraph wkg://book.wikg/chapter add --stage planned",
        note: "Create a new chapter.",
        verb: "add",
      },
      {
        command: "wikigraph wkg://book.wikg/chapter/12 get",
        note: "Read a chapter object.",
        verb: "get",
      },
      {
        command: 'wikigraph wkg://book.wikg/chapter/12 search "keyword"',
        note: "Search within one chapter scope.",
        verb: "search",
      },
      {
        command: "wikigraph wkg://book.wikg/chapter/12/entity list",
        note: "List entity objects scoped to one chapter.",
        verb: "list",
      },
      {
        command: "wikigraph wkg://book.wikg/chapter/12/state get",
        note: "Inspect one chapter stage and artifacts.",
        verb: "get",
      },
      {
        command:
          "wikigraph wkg://book.wikg/chapter/12 move --parent wkg://book.wikg/chapter/3",
        note: "Move a chapter in the TOC tree.",
        verb: "move",
      },
      {
        command: "wikigraph wkg://book.wikg/chapter/12 remove",
        note: "Delete a chapter.",
        verb: "remove",
      },
      {
        command: "wikigraph wkg://book.wikg/chapter/12 reset --to source",
        note: "Delete later-stage artifacts.",
        verb: "reset",
      },
      {
        command:
          "wikigraph wkg://book.wikg/chapter/12 queue add --task reading-graph --accept-cost",
        note: "Queue generated work for the chapter.",
        verb: "queue",
      },
    ],
  },
  {
    description: "One chapter's stored artifact readiness.",
    name: "chapter-state",
    title: "Chapter State",
    uriForms: [
      "wkg://book.wikg/chapter/12/state",
      "wkg://book.wikg/chapter/12/state/reading-graph",
      "wkg://book.wikg/chapter/12/state/knowledge-graph",
    ],
    verbs: [
      {
        command: "wikigraph wkg://book.wikg/chapter/12/state get --json",
        note: "Inspect aggregate chapter state.",
        verb: "get",
      },
      {
        command:
          "wikigraph wkg://book.wikg/chapter/12/state/reading-graph get --json",
        note: "Inspect one Reading Graph target state.",
        verb: "get",
      },
      {
        command:
          "wikigraph wkg://book.wikg/chapter/12/state/knowledge-graph get --json",
        note: "Inspect one Knowledge Graph target state.",
        verb: "get",
      },
    ],
  },
  {
    description: "The complete chapter tree resource.",
    name: "chapter-tree",
    title: "Chapter Tree",
    uriForms: ["wkg://book.wikg/chapter/tree"],
    verbs: [
      {
        command: "wikigraph wkg://book.wikg/chapter/tree get",
        note: "Read the full chapter tree.",
        verb: "get",
      },
      {
        command: "wikigraph wkg://book.wikg/chapter/tree set --input tree.json",
        note: "Replace chapter order and titles from a full tree JSON.",
        verb: "set",
      },
    ],
  },
  {
    description: "A chapter's source text resource.",
    name: "chapter-source",
    title: "Chapter Source",
    uriForms: ["wkg://book.wikg/chapter/12/source"],
    verbs: [
      {
        command: "wikigraph wkg://book.wikg/chapter/12/source get",
        note: "Read chapter source text.",
        verb: "get",
      },
      {
        command:
          "wikigraph wkg://book.wikg/chapter/12/source set --input chapter.md --input-format markdown",
        note: "Fill a planned chapter with source text.",
        verb: "set",
      },
    ],
  },
  {
    description: "A chapter's final summary resource.",
    name: "chapter-summary",
    title: "Chapter Summary",
    uriForms: ["wkg://book.wikg/chapter/12/summary"],
    verbs: [
      {
        command: "wikigraph wkg://book.wikg/chapter/12/summary get",
        note: "Read a chapter summary.",
        verb: "get",
      },
      {
        command:
          "wikigraph wkg://book.wikg/chapter/12/summary set --input summary.md",
        note: "Write a manual summary for a graphed chapter.",
        verb: "set",
      },
    ],
  },
  {
    description: "A chapter's TOC title resource.",
    name: "chapter-title",
    title: "Chapter Title",
    uriForms: ["wkg://book.wikg/chapter/12/title"],
    verbs: [
      {
        command:
          'wikigraph wkg://book.wikg/chapter/12/title set --title "New Title"',
        note: "Set or clear the chapter title.",
        verb: "set",
      },
    ],
  },
  {
    description: "Original source text or source ranges.",
    name: "source",
    title: "Source",
    uriForms: [
      "wkg://book.wikg/source",
      "wkg://book.wikg/chapter/12/source",
      "wkg://book.wikg/chapter/12/source#4..8",
    ],
    verbs: [
      {
        command: 'wikigraph wkg://book.wikg/source search "keyword"',
        note: "Search source text across the archive.",
        verb: "search",
      },
      {
        command: "wikigraph wkg://book.wikg/chapter/12/source list",
        note: "List source ranges within a chapter.",
        verb: "list",
      },
      {
        command: "wikigraph wkg://book.wikg/chapter/12/source#4..8 get",
        note: "Read source text or a source range.",
        verb: "get",
      },
    ],
  },
  {
    description: "Readable chapter summary text as a searchable object.",
    name: "summary",
    title: "Summary",
    uriForms: ["wkg://book.wikg/summary", "wkg://book.wikg/chapter/12/summary"],
    verbs: [
      {
        command: 'wikigraph wkg://book.wikg/summary search "keyword"',
        note: "Search summary text across the archive.",
        verb: "search",
      },
      {
        command: "wikigraph wkg://book.wikg/summary list",
        note: "List summary objects.",
        verb: "list",
      },
      {
        command: "wikigraph wkg://book.wikg/chapter/12/summary get",
        note: "Read summary text.",
        verb: "get",
      },
      {
        command: "wikigraph wkg://book.wikg/chapter/12/summary evidence",
        note: "Trace summary support back to source.",
        verb: "evidence",
      },
    ],
  },
  {
    description: "A Reading Graph chunk.",
    name: "chunk",
    title: "Chunk",
    uriForms: ["wkg://book.wikg/chunk", "wkg://book.wikg/chunk/123"],
    verbs: [
      {
        command: 'wikigraph wkg://book.wikg/chunk search "keyword"',
        note: "Search Reading Graph chunks.",
        verb: "search",
      },
      {
        command: "wikigraph wkg://book.wikg/chunk list",
        note: "List Reading Graph chunks.",
        verb: "list",
      },
      {
        command: "wikigraph wkg://book.wikg/chunk/123 get",
        note: "Read one chunk.",
        verb: "get",
      },
      {
        command: "wikigraph wkg://book.wikg/chunk/123 related",
        note: "Expand to nearby Reading Graph chunks.",
        verb: "related",
      },
      {
        command: "wikigraph wkg://book.wikg/chunk/123 evidence",
        note: "Trace chunk support back to source.",
        verb: "evidence",
      },
      {
        command: "wikigraph wkg://book.wikg/chunk/123 pack --budget 5000",
        note: "Assemble bounded context around the chunk.",
        verb: "pack",
      },
    ],
  },
  {
    description: "A Knowledge Graph entity grouped from mentions.",
    name: "entity",
    title: "Entity",
    uriForms: ["wkg://book.wikg/entity", "wkg://book.wikg/entity/Q9957"],
    verbs: [
      {
        command: 'wikigraph wkg://book.wikg/entity search "keyword"',
        note: "Search entities.",
        verb: "search",
      },
      {
        command: "wikigraph wkg://book.wikg/chapter/12/entity list",
        note: "List entities, optionally scoped to a chapter.",
        verb: "list",
      },
      {
        command: "wikigraph wkg://book.wikg/entity/Q9957 get",
        note: "Read one entity.",
        verb: "get",
      },
      {
        command:
          "wikigraph wkg://book.wikg/entity/Q9957 related --role subject",
        note: "List triples related to the entity.",
        verb: "related",
      },
      {
        command: "wikigraph wkg://book.wikg/entity/Q9957 evidence",
        note: "Trace entity mentions back to source.",
        verb: "evidence",
      },
      {
        command: "wikigraph wkg://book.wikg/entity/Q9957 pack --budget 5000",
        note: "Pack bounded source-backed context.",
        verb: "pack",
      },
    ],
  },
  {
    description: "A Knowledge Graph relation between two entities.",
    name: "triple",
    title: "Triple",
    uriForms: [
      "wkg://book.wikg/triple",
      "wkg://book.wikg/triple/Q9957/participant_in/Q178561",
    ],
    verbs: [
      {
        command: 'wikigraph wkg://book.wikg/triple search "keyword"',
        note: "Search triples.",
        verb: "search",
      },
      {
        command: "wikigraph wkg://book.wikg/triple list",
        note: "List triples.",
        verb: "list",
      },
      {
        command:
          "wikigraph wkg://book.wikg/triple/Q9957/participant_in/Q178561 get",
        note: "Read one triple.",
        verb: "get",
      },
      {
        command:
          "wikigraph wkg://book.wikg/triple/Q9957/participant_in/Q178561 evidence",
        note: "Trace relation evidence back to source.",
        verb: "evidence",
      },
    ],
  },
  {
    description: "The local generation job collection.",
    name: "job-collection",
    title: "Job Collection",
    uriForms: ["wkg-job://"],
    verbs: [
      {
        command: "wikigraph wkg-job:// list --json",
        note: "List queue jobs.",
        verb: "list",
      },
    ],
  },
  {
    aliases: ["job"],
    description: "One local generation job.",
    name: "job",
    title: "Job",
    uriForms: ["wkg-job://<job-id>"],
    verbs: [
      {
        command: "wikigraph wkg-job://<job-id> get --json",
        note: "Inspect one job.",
        verb: "get",
      },
      {
        command: "wikigraph wkg-job://<job-id> watch --jsonl",
        note: "Follow durable job progress.",
        verb: "watch",
      },
      {
        command: "wikigraph wkg-job://<job-id> pause",
        note: "Pause an active job.",
        verb: "pause",
      },
      {
        command: "wikigraph wkg-job://<job-id> resume",
        note: "Resume a paused job.",
        verb: "resume",
      },
      {
        command: "wikigraph wkg-job://<job-id> cancel",
        note: "Cancel an active job.",
        verb: "cancel",
      },
      {
        command: "wikigraph wkg-job://<job-id> boost",
        note: "Move a queued job forward.",
        verb: "boost",
      },
      {
        command: "wikigraph wkg-job://<job-id> set --task reading-summary",
        note: "Change an active job target.",
        verb: "set",
      },
    ],
  },
  {
    description: "A continuation cursor returned by paged commands.",
    name: "cursor",
    title: "Cursor",
    uriForms: ["c_abc123"],
    verbs: [
      {
        command: "wikigraph next c_abc123 --limit 10",
        note: "Read the next page for any cursor.",
        verb: "next",
      },
    ],
  },
] as const;

const HELP_VERBS: readonly HelpVerbEntry[] = [
  {
    description: "Create a new archive or object.",
    name: "create",
    title: "Create",
  },
  { description: "Open or render an object.", name: "get", title: "Get" },
  {
    description: "Modify a writable object resource.",
    name: "set",
    title: "Set",
  },
  {
    description: "List objects in a collection or scope.",
    name: "list",
    title: "List",
  },
  {
    description: "Add a child object to a collection.",
    name: "add",
    title: "Add",
  },
  {
    description: "Find objects from query text.",
    name: "search",
    title: "Search",
  },
  {
    description: "Expand from one object to nearby objects.",
    name: "related",
    title: "Related",
  },
  {
    description: "Trace an object back to source-backed evidence.",
    name: "evidence",
    title: "Evidence",
  },
  {
    description: "Pack bounded context around an object.",
    name: "pack",
    title: "Pack",
  },
  {
    description: "Move a chapter object in the chapter tree.",
    name: "move",
    title: "Move",
  },
  { description: "Remove a chapter object.", name: "remove", title: "Remove" },
  {
    description: "Delete later-stage artifacts for a chapter.",
    name: "reset",
    title: "Reset",
  },
  {
    description: "Queue generated work for a chapter.",
    name: "queue",
    title: "Queue",
  },
  { description: "Watch a queued job.", name: "watch", title: "Watch" },
  { description: "Pause a queued job.", name: "pause", title: "Pause" },
  { description: "Resume a paused job.", name: "resume", title: "Resume" },
  { description: "Cancel a queued job.", name: "cancel", title: "Cancel" },
  { description: "Boost a queued job.", name: "boost", title: "Boost" },
  {
    description: "Estimate generated work before queueing it.",
    name: "estimate",
    title: "Estimate",
  },
  {
    description: "Export an archive projection.",
    name: "export",
    title: "Export",
  },
  { description: "Read a continuation cursor.", name: "next", title: "Next" },
] as const;

export const ARCHIVE_COMMANDS = [
  "create",
  "search",
  "list",
  "get",
  "related",
  "evidence",
  "next",
  "pack",
  "estimate",
  "export",
] as const satisfies readonly CLIArchiveAction[];

export const ARCHIVE_MAINTENANCE_COMMANDS = [
  "cover",
  "meta",
  "chapter",
] as const satisfies readonly CLIArchiveMaintenanceCommand[];

const HELP_TOPIC_METADATA: readonly {
  readonly name: HelpTopic;
  readonly summary: string;
}[] = [
  {
    name: "overview",
    summary: "Mental model, processing paths, and when LLM access is needed.",
  },
  {
    name: "task",
    summary: "Task-oriented entry points for common workflows.",
  },
  {
    name: "command",
    summary: "Top-level commands, flags, and command family boundaries.",
  },
  {
    name: "object",
    summary: "URI-addressed objects and the verbs each object supports.",
  },
  {
    name: "verb",
    summary: "Verb semantics and object-specific implementations.",
  },
  {
    name: "matrix",
    summary: "Cross-reference of objects and verbs.",
  },
  {
    name: "format",
    summary: "Supported formats, inference rules, and IO constraints.",
  },
  {
    name: "config",
    summary: "Configuration overview, precedence, and when each layer applies.",
  },
  {
    name: "env",
    summary: "Detailed environment variable reference.",
  },
  {
    name: "config-file",
    summary: "Detailed ~/.wikigraph/config.json reference.",
  },
  {
    name: "runtime",
    summary: "Exit behavior, streams, progress, and digest workspace rules.",
  },
  {
    name: "uri",
    summary: "Wiki Graph URI grammar, archive locators, scopes, and objects.",
  },
  {
    name: "recipe",
    summary: "Short copyable command examples.",
  },
  {
    name: "troubleshoot",
    summary: "Common failure modes and what to check first.",
  },
  {
    name: "ai",
    summary: "Navigation hints and operating contract for AI agents.",
  },
] as const;

const ARCHIVE_MAINTENANCE_COMMAND_METADATA: readonly {
  readonly name: CLIArchiveMaintenanceCommand;
  readonly summary: string;
}[] = [
  {
    name: "cover",
    summary: "Write raw cover bytes to stdout for redirection or piping.",
  },
  {
    name: "meta",
    summary: "Read or edit book metadata stored in the archive.",
  },
  {
    name: "chapter",
    summary: "Edit the chapter tree and per-chapter digest stages.",
  },
] as const;

const HELP_TOPIC_TEMPLATE_NAMES: Readonly<Record<HelpTopic, string>> = {
  overview: "help/topics/overview",
  task: "help/topics/task",
  command: "help/topics/command",
  object: "help/topics/object",
  verb: "help/topics/verb",
  matrix: "help/topics/matrix",
  format: "help/topics/format",
  config: "help/topics/config",
  env: "help/topics/env",
  "config-file": "help/topics/config-file",
  runtime: "help/topics/runtime",
  uri: "help/topics/uri",
  recipe: "help/topics/recipe",
  troubleshoot: "help/topics/troubleshoot",
  ai: "help/topics/ai",
};

const HELP_OBJECT_LOOKUP = new Map<string, HelpObjectEntry>(
  HELP_OBJECTS.flatMap((object) => [
    [object.name, object],
    ...(object.aliases ?? []).map((alias) => [alias, object] as const),
  ]),
);

const HELP_VERB_LOOKUP = new Map<string, HelpVerbEntry>(
  HELP_VERBS.map((verb) => [verb.name, verb]),
);

let helpTemplateEnvironment: ReturnType<typeof createEnv> | undefined;

export function renderMainHelpText(): string {
  return renderHelpTemplate("help/commands/root");
}

export function renderStatusHelpText(): string {
  return renderHelpTemplate("help/commands/config-status");
}

export function renderTransformHelpText(): string {
  return renderHelpTemplate("help/commands/transform");
}

export function renderLegacyCommandHelpText(action?: "migrate"): string {
  return renderHelpTemplate(
    action === undefined
      ? "help/commands/legacy"
      : `help/commands/legacy/${action}`,
  );
}

export function renderQueueCommandHelpText(action?: CLIQueueAction): string {
  return renderHelpTemplate(
    action === undefined
      ? "help/commands/queue"
      : `help/commands/queue/${action}`,
  );
}

export function renderArchiveCommandHelpText(action: CLIArchiveAction): string {
  return renderHelpTemplate(`help/commands/archive/${action}`);
}

export function renderHelpTopicText(topic: HelpTopic): string {
  return renderHelpTemplate(HELP_TOPIC_TEMPLATE_NAMES[topic]);
}

export function renderHelpMatrixText(page: HelpMatrixPage): string {
  switch (page.kind) {
    case "matrix":
      return renderHelpTemplate("help/topics/matrix");
    case "object":
      return renderHelpTemplate("help/topics/object", {
        selectedObject:
          page.object === undefined
            ? undefined
            : requireHelpObject(page.object),
      });
    case "verb":
      return renderHelpTemplate("help/topics/verb", {
        selectedVerb:
          page.verb === undefined ? undefined : createHelpVerbView(page.verb),
      });
  }
}

export function renderArchiveMaintenanceCommandHelpText(
  command: CLIArchiveMaintenanceCommand,
): string {
  return renderHelpTemplate(`help/commands/maintenance/${command}`);
}

export function renderArchiveMaintenanceChapterActionHelpText(
  action: CLIArchiveChapterAction,
): string {
  return renderHelpTemplate(`help/commands/maintenance/chapter/${action}`);
}

export function parseHelpTopic(value: string): HelpTopic {
  const normalized = value.trim().toLowerCase();

  if (HELP_TOPICS.includes(normalized as HelpTopic)) {
    return normalized as HelpTopic;
  }

  throw new Error(
    withHelpRoute(
      `Invalid help topic: ${value}. Expected one of ${HELP_TOPICS.join(", ")}.`,
      CLI_HELP_ROUTES.root,
    ),
  );
}

export function parseHelpMatrixPage(
  positionals: readonly string[],
): HelpMatrixPage | undefined {
  const [kind, target] = positionals;

  if (kind === "matrix") {
    if (target !== undefined) {
      throw new Error(
        withHelpRoute(
          `Unexpected positional arguments: ${positionals.slice(1).join(" ")}.`,
          CLI_HELP_ROUTES.root,
        ),
      );
    }
    return { kind: "matrix" };
  }

  if (kind === "object") {
    if (positionals.length > 2) {
      throw new Error(
        withHelpRoute(
          `Unexpected positional arguments: ${positionals.slice(2).join(" ")}.`,
          CLI_HELP_ROUTES.root,
        ),
      );
    }
    return {
      kind: "object",
      ...(target === undefined ? {} : { object: parseHelpObjectName(target) }),
    };
  }

  if (kind === "verb") {
    if (positionals.length > 2) {
      throw new Error(
        withHelpRoute(
          `Unexpected positional arguments: ${positionals.slice(2).join(" ")}.`,
          CLI_HELP_ROUTES.root,
        ),
      );
    }
    return {
      kind: "verb",
      ...(target === undefined ? {} : { verb: parseHelpVerbName(target) }),
    };
  }

  if (positionals.length === 1 && kind !== undefined) {
    const object = parseHelpObjectNameOrUndefined(kind);
    if (object !== undefined) {
      return { kind: "object", object };
    }

    const verb = parseHelpVerbNameOrUndefined(kind);
    if (verb !== undefined) {
      return { kind: "verb", verb };
    }
  }

  return undefined;
}

function parseHelpObjectName(value: string): HelpObjectName {
  const object = parseHelpObjectNameOrUndefined(value);

  if (object !== undefined) {
    return object;
  }

  throw new Error(
    withHelpRoute(
      `Invalid help object: ${value}. Expected one of ${HELP_OBJECTS.map((entry) => entry.name).join(", ")}.`,
      CLI_HELP_ROUTES.root,
    ),
  );
}

function parseHelpObjectNameOrUndefined(
  value: string,
): HelpObjectName | undefined {
  return HELP_OBJECT_LOOKUP.get(value.trim().toLowerCase())?.name;
}

function parseHelpVerbName(value: string): HelpVerbName {
  const verb = parseHelpVerbNameOrUndefined(value);

  if (verb !== undefined) {
    return verb;
  }

  throw new Error(
    withHelpRoute(
      `Invalid help verb: ${value}. Expected one of ${HELP_VERBS.map((entry) => entry.name).join(", ")}.`,
      CLI_HELP_ROUTES.root,
    ),
  );
}

function parseHelpVerbNameOrUndefined(value: string): HelpVerbName | undefined {
  return HELP_VERB_LOOKUP.get(value.trim().toLowerCase())?.name;
}

function requireHelpObject(name: HelpObjectName): HelpObjectEntry {
  const object = HELP_OBJECT_LOOKUP.get(name);

  if (object === undefined) {
    throw new Error(`Internal error: unknown help object ${name}.`);
  }

  return object;
}

function requireHelpVerb(name: HelpVerbName): HelpVerbEntry {
  const verb = HELP_VERB_LOOKUP.get(name);

  if (verb === undefined) {
    throw new Error(`Internal error: unknown help verb ${name}.`);
  }

  return verb;
}

function createHelpVerbView(name: HelpVerbName): HelpVerbView {
  const verb = requireHelpVerb(name);

  return {
    ...verb,
    objects: createHelpVerbObjectRows(name),
  };
}

function createHelpVerbObjectRows(
  name: HelpVerbName,
): readonly HelpVerbObjectRows[] {
  return HELP_OBJECTS.map((object) => ({
    object,
    rows: object.verbs.filter((item) => item.verb === name),
  })).filter((item) => item.rows.length > 0);
}

function renderHelpTemplate(
  templateName: string,
  extraContext: Record<string, unknown> = {},
): string {
  return getHelpTemplateEnvironment().render(templateName, {
    formats: CLI_FORMATS,
    helpTopics: HELP_TOPIC_METADATA,
    archiveMaintenanceCommands: ARCHIVE_MAINTENANCE_COMMAND_METADATA,
    helpObjects: HELP_OBJECTS,
    helpVerbs: HELP_VERBS,
    helpVerbRows: HELP_VERBS.map((verb) => ({
      ...verb,
      objects: createHelpVerbObjectRows(verb.name),
    })),
    ...extraContext,
  });
}

function getHelpTemplateEnvironment(): ReturnType<typeof createEnv> {
  helpTemplateEnvironment ??= createEnv(resolveDataDirPath(), {
    autoescape: false,
  });

  return helpTemplateEnvironment;
}
