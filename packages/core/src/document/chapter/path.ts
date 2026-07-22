import type { TocItem } from "../../text/source/index.js";

export const RESERVED_CHAPTER_KEYS = new Set([
  "tree",
  "source",
  "summary",
  "title",
  "state",
  "chunk",
  "entity",
  "triple",
  "cover",
  "meta",
  "job",
  "help",
]);

export function formatChapterUri(path: string): string {
  return `wikg://chapter/${path}`;
}

export function parseChapterPath(
  value: string,
  label = "chapter path",
): string {
  const normalized = value.trim();
  if (normalized === "") {
    throw new Error(`Invalid ${label}: expected an absolute chapter path.`);
  }
  if (/^\d+$/u.test(normalized)) {
    throw new Error(
      `Invalid ${label}: numeric chapter ids are internal and are not accepted.`,
    );
  }
  if (normalized.startsWith("/") || normalized.endsWith("/")) {
    throw new Error(
      `Invalid ${label}: use <key>[/<key>]* without leading or trailing slash.`,
    );
  }
  const parts = normalized.split("/");
  for (const part of parts) {
    validateChapterKey(part, label);
  }
  return parts.join("/");
}

export function parseChapterUriPath(uri: string): string | undefined {
  const match = /^wikg:\/\/chapter\/(.+)$/u.exec(uri.trim());
  if (match?.[1] === undefined) {
    return undefined;
  }
  return parseChapterPath(match[1], "chapter URI");
}

export function validateChapterKey(key: string, label = "chapter key"): string {
  if (key === "" || key === "." || key === ".." || key.includes("/")) {
    throw new Error(
      `Invalid ${label}: chapter paths do not support empty, '.', '..', or relative segments.`,
    );
  }
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(key)) {
    throw new Error(
      `Invalid ${label}: ${key}. Use lowercase letters, numbers, and hyphens.`,
    );
  }
  if (RESERVED_CHAPTER_KEYS.has(key)) {
    throw new Error(`Invalid ${label}: ${key} is reserved.`);
  }
  return key;
}

export function createChapterKey(
  input: string | null | undefined,
  existingKeys: ReadonlySet<string>,
): string {
  const base = slugify(input ?? "chapter") || "chapter";
  let key = RESERVED_CHAPTER_KEYS.has(base) ? `${base}-chapter` : base;
  key = ensureValidKeyBase(key);
  if (!existingKeys.has(key)) {
    return key;
  }
  for (let index = 2; ; index += 1) {
    const candidate = `${key}-${index}`;
    if (!existingKeys.has(candidate)) {
      return candidate;
    }
  }
}

export function resolveChapterIdByPath(
  items: readonly TocItem[],
  chapterPath: string,
): number | undefined {
  const parts = parseChapterPath(chapterPath).split("/");
  let siblings = items;
  let current: TocItem | undefined;
  for (const part of parts) {
    current = siblings.find((item) => item.key === part);
    if (current === undefined) {
      return undefined;
    }
    siblings = current.children;
  }
  return current?.serialId;
}

export function collectChapterKeys(
  items: readonly TocItem[],
  keys = new Set<string>(),
): Set<string> {
  for (const item of items) {
    if (item.key !== undefined) {
      keys.add(item.key);
    }
    collectChapterKeys(item.children, keys);
  }
  return keys;
}

export function collectChapterPathById(
  items: readonly TocItem[],
  chapterId: number,
  prefix: readonly string[] = [],
): string | undefined {
  for (const item of items) {
    if (item.key === undefined) {
      continue;
    }
    const path = [...prefix, item.key];
    if (item.serialId === chapterId) {
      return path.join("/");
    }
    const childPath = collectChapterPathById(item.children, chapterId, path);
    if (childPath !== undefined) {
      return childPath;
    }
  }
  return undefined;
}

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .replace(/-{2,}/gu, "-");
}

function ensureValidKeyBase(value: string): string {
  const normalized = value.replace(/^-+/u, "").replace(/-+$/u, "");
  if (/^[a-z0-9][a-z0-9-]*$/u.test(normalized)) {
    return normalized;
  }
  return "chapter";
}
