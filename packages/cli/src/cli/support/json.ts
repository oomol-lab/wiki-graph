type JSONLike =
  | readonly JSONLike[]
  | { readonly [key: string]: JSONLike }
  | boolean
  | null
  | number
  | string;

const CLI_JSON_KEY_PRIORITY = new Map(
  [
    "at",
    "seq",
    "uri",
    "id",
    "jobId",
    "type",
    "target",
    "label",
    "labels",
    "title",
    "state",
    "name",
    "qid",
    "predicate",
    "subjectLabel",
    "objectLabel",
    "subjectQid",
    "objectQid",
    "score",
    "queueRank",
    "chapter",
    "chapterId",
    "fragment",
    "fragmentId",
    "position",
    "range",
    "start",
    "end",
    "shown",
    "total",
    "count",
    "mentionCount",
    "nodeCount",
    "edgeCount",
    "summaryCount",
    "limit",
    "order",
    "match",
    "lens",
    "terms",
    "types",
    "chapters",
    "query",
    "objects",
    "items",
    "nextCursor",
    "archiveKey",
    "archivePath",
    "workspacePath",
    "eventsPath",
    "createdAt",
    "updatedAt",
    "finishedAt",
    "currentStep",
    "step",
    "phase",
    "phaseDetail",
    "phaseDone",
    "phaseTotal",
    "phaseUnit",
    "words",
    "totalWords",
    "outputTokens",
    "authors",
    "language",
    "identifier",
    "publisher",
    "publishedAt",
    "sourceFormat",
    "snippet",
    "summary",
    "description",
    "recommendation",
    "risk",
    "error",
    "message",
    "children",
    "nodes",
    "links",
    "neighbors",
    "incoming",
    "outgoing",
    "nodeGroups",
    "sourceFragments",
    "sources",
    "tree",
    "meta",
    "evidence",
    "content",
    "source",
    "text",
    "prompt",
    "llmJSON",
    "errorJSON",
  ].map((key, index) => [key, index]),
);

export function formatCLIJSON(value: unknown): string {
  return `${JSON.stringify(orderCLIJSONValue(value), null, 2)}\n`;
}

export function formatCLIJSONLine(value: unknown): string {
  return `${JSON.stringify(orderCLIJSONValue(value))}\n`;
}

function orderCLIJSONValue(value: unknown): JSONLike | undefined {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => orderCLIJSONValue(item) ?? null);
  }

  if (typeof value !== "object") {
    return undefined;
  }

  return orderCLIJSONObject(value as Record<string, unknown>);
}

function orderCLIJSONObject(value: Record<string, unknown>): JSONLike {
  const entries = Object.entries(value).map(([key, entryValue], index) => ({
    index,
    key,
    priority: CLI_JSON_KEY_PRIORITY.get(key) ?? Number.MAX_SAFE_INTEGER,
    value: entryValue,
  }));
  const ordered: Record<string, JSONLike> = {};

  for (const entry of entries.sort(
    (left, right) => left.priority - right.priority || left.index - right.index,
  )) {
    const orderedValue = orderCLIJSONValue(entry.value);

    if (orderedValue !== undefined) {
      ordered[entry.key] = orderedValue;
    }
  }

  return ordered;
}
