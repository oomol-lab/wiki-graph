import type { BookMeta, TocItem } from "../../source/index.js";

import type { EpubNavItem, EpubSection } from "./model.js";
import { escapeXml } from "./shared.js";
import { renderNavDocument } from "./templates.js";

export function buildNavItems(
  items: readonly TocItem[],
  sectionMap: ReadonlyMap<number, EpubSection>,
): EpubNavItem[] {
  return items.map((item) => ({
    children: buildNavItems(item.children, sectionMap),
    href:
      item.serialId === undefined
        ? undefined
        : sectionMap.get(item.serialId)?.href,
    title: item.title?.trim() || `Section ${item.serialId ?? 1}`,
  }));
}

export function createNavDocument(
  meta: BookMeta,
  language: string,
  items: readonly EpubNavItem[],
): string {
  const title = meta.title?.trim() || "Untitled";

  return renderNavDocument({
    itemsMarkup: renderNavItems(items),
    language,
    title,
  });
}

function renderNavItems(items: readonly EpubNavItem[]): string {
  if (items.length === 0) {
    return "<ol></ol>";
  }

  return `<ol>\n${items.map((item) => renderNavItem(item, 1)).join("\n")}\n</ol>`;
}

function renderNavItem(item: EpubNavItem, depth: number): string {
  const indent = "  ".repeat(depth);
  const label =
    item.href === undefined
      ? `<span>${escapeXml(item.title)}</span>`
      : `<a href="${escapeXml(item.href)}">${escapeXml(item.title)}</a>`;
  const children =
    item.children.length === 0
      ? ""
      : `\n${indent}  <ol>\n${item.children
          .map((child) => renderNavItem(child, depth + 2))
          .join("\n")}\n${indent}  </ol>`;

  return `${indent}<li>${label}${children}</li>`;
}
