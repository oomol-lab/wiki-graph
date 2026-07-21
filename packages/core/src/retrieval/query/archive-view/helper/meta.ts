import type { BookMeta } from "../../../../text/source/index.js";

export function createSnippet(value: string, needle?: string): string {
  const collapsed = value.replace(/\s+/g, " ").trim();

  if (needle === undefined) {
    return collapsed.length > 180 ? `${collapsed.slice(0, 177)}...` : collapsed;
  }

  const index = collapsed.toLowerCase().indexOf(needle);

  if (index < 0) {
    return collapsed.length > 180 ? `${collapsed.slice(0, 177)}...` : collapsed;
  }

  const start = Math.max(0, index - 60);
  const end = Math.min(collapsed.length, index + needle.length + 120);
  const prefix = start === 0 ? "" : "...";
  const suffix = end === collapsed.length ? "" : "...";

  return `${prefix}${collapsed.slice(start, end)}${suffix}`;
}

export function formatMetaSummary(meta: BookMeta | undefined): string {
  if (meta === undefined) {
    return "[missing]";
  }

  return [meta.title, meta.authors.join(", "), meta.publisher]
    .filter((value) => value !== null && value !== "")
    .join(" / ");
}

export function formatMetaTitle(meta: BookMeta | undefined): string {
  return meta?.title ?? "Archive metadata";
}

export function createMetaPage(meta: BookMeta | undefined): {
  readonly authors?: readonly string[];
  readonly description?: string;
  readonly publisher?: string;
  readonly title: string;
} {
  return {
    ...(meta?.authors === undefined || meta.authors.length === 0
      ? {}
      : { authors: meta.authors }),
    ...(meta?.description === undefined || meta.description === null
      ? {}
      : { description: meta.description }),
    ...(meta?.publisher === undefined || meta.publisher === null
      ? {}
      : { publisher: meta.publisher }),
    title: formatMetaTitle(meta),
  };
}

export function formatMetaText(meta: BookMeta | undefined): string {
  const page = createMetaPage(meta);

  return [
    `title: ${page.title}`,
    page.authors === undefined
      ? undefined
      : `authors: ${page.authors.join(", ")}`,
    page.publisher === undefined ? undefined : `publisher: ${page.publisher}`,
    page.description === undefined
      ? undefined
      : `description: ${page.description}`,
  ]
    .filter(isDefined)
    .join("\n");
}

export function formatWeight(weight: number): string {
  return Number.isInteger(weight) ? String(weight) : weight.toFixed(3);
}

export function isDefined<T>(value: T | undefined | null): value is T {
  return value !== undefined && value !== null;
}
