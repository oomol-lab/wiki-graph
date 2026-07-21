import { formatCLIJSON } from "../../../../support/index.js";
import { PLAIN_OBJECT_KEY_PRIORITY } from "../types.js";

export function formatPlainObject(value: unknown): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return String(value);
  }

  return Object.entries(value)
    .filter(([, item]) => item !== undefined && item !== null)
    .sort(([left], [right]) => comparePlainObjectKeys(left, right))
    .map(([key, item]) => `${key}: ${formatPlainValue(item)}`)
    .join("\n");
}

export function formatStatePageText(value: unknown): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return String(value);
  }

  const object = value as {
    readonly state?: Record<string, string>;
    readonly uri?: string;
    readonly value?: string;
  };

  if (object.value !== undefined) {
    return `${object.uri ?? "state"} ${object.value}`;
  }

  if (object.state !== undefined) {
    return [object.uri, formatStateBlock(object.state)]
      .filter((line): line is string => line !== undefined && line !== "")
      .join("\n");
  }

  return formatPlainObject(value);
}

function formatStateBlock(state: Record<string, string>): string {
  return formatStateEntries(state)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
}

export function formatStateInline(state: Record<string, string>): string {
  return formatStateEntries(state)
    .map(([key, value]) => `${key}:${value}`)
    .join(" ");
}

function formatStateEntries(
  state: Record<string, string>,
): readonly (readonly [string, string])[] {
  const entries: readonly (readonly [string, string | undefined])[] = [
    ["source", state.source],
    ["reading-graph", state["reading-graph"]],
    ["reading-summary", state["reading-summary"]],
    ["knowledge-graph", state["knowledge-graph"]],
  ];

  return entries.filter(
    (entry): entry is readonly [string, string] => entry[1] !== undefined,
  );
}

function comparePlainObjectKeys(left: string, right: string): number {
  return getPlainObjectKeyOrder(left) - getPlainObjectKeyOrder(right);
}

function getPlainObjectKeyOrder(key: string): number {
  const index = PLAIN_OBJECT_KEY_PRIORITY.indexOf(
    key as (typeof PLAIN_OBJECT_KEY_PRIORITY)[number],
  );

  return index < 0 ? PLAIN_OBJECT_KEY_PRIORITY.length : index;
}

function formatPlainValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).join(", ");
  }
  if (typeof value === "object" && value !== null) {
    return formatCLIJSON(value).trimEnd();
  }

  return String(value);
}
