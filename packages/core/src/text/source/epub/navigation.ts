import { basename, extname, posix } from "path";

import { parseDocument } from "htmlparser2";

import { splitHref } from "./archive.js";
import type { EpubArchive } from "./archive.js";
import { type EpubPackageData } from "./package.js";
import {
  findChild,
  findChildren,
  getAttribute,
  getDescendantText,
  parseXml,
  type XmlElement,
} from "./xml.js";

const NON_CONTENT_FILE_NAMES = new Set([
  "toc.xhtml",
  "nav.xhtml",
  "contents.xhtml",
  "tableofcontents.xhtml",
  "cover.xhtml",
  "titlepage.xhtml",
]);

interface HtmlNode {
  readonly type?: string;
  readonly name?: string;
  readonly data?: string;
  readonly attribs?: Readonly<Record<string, string>>;
  readonly children?: readonly HtmlNode[];
}

export interface EpubNavigationItem {
  readonly title: string | undefined;
  readonly path: string | undefined;
  readonly fragment: string | undefined;
  readonly children: readonly EpubNavigationItem[];
}

export async function readEpubNavigation(
  archive: EpubArchive,
  packageData: EpubPackageData,
): Promise<readonly EpubNavigationItem[]> {
  const navigation =
    (await readNavDocument(archive, packageData)) ??
    (await readNcxDocument(archive, packageData)) ??
    [];

  if (navigation.length === 0) {
    return buildSpineNavigation(packageData, new Set());
  }

  const referencedPaths = collectReferencedPaths(navigation);
  const extras = buildSpineNavigation(packageData, referencedPaths);

  return extras.length === 0 ? navigation : [...navigation, ...extras];
}

async function readNavDocument(
  archive: EpubArchive,
  packageData: EpubPackageData,
): Promise<readonly EpubNavigationItem[] | undefined> {
  if (packageData.navPath === undefined) {
    return undefined;
  }

  const document = parseDocument(await archive.readText(packageData.navPath), {
    decodeEntities: true,
  }) as HtmlNode;
  const nav = findFirstHtmlElement(document, (element) => {
    if (getHtmlTagName(element) !== "nav") {
      return false;
    }

    const type = (element.attribs?.["epub:type"] ?? element.attribs?.type ?? "")
      .split(/\s+/u)
      .map((value) => value.trim().toLowerCase());

    return type.includes("toc");
  });

  if (nav === undefined) {
    return undefined;
  }

  const ol = findFirstHtmlElement(
    nav,
    (element) => getHtmlTagName(element) === "ol",
  );
  if (ol === undefined) {
    return undefined;
  }

  const items = getHtmlElementChildren(ol)
    .filter((child) => getHtmlTagName(child) === "li")
    .map((li) => parseNavListItem(archive, packageData.navPath!, li))
    .filter((item): item is EpubNavigationItem => item !== undefined);

  return items.length === 0 ? undefined : items;
}

async function readNcxDocument(
  archive: EpubArchive,
  packageData: EpubPackageData,
): Promise<readonly EpubNavigationItem[] | undefined> {
  if (packageData.ncxPath === undefined) {
    return undefined;
  }

  const root = parseXml(await archive.readText(packageData.ncxPath));
  const navMap = findChild(root, "navMap");
  if (navMap === undefined) {
    return undefined;
  }

  const items = findChildren(navMap, "navPoint")
    .map((navPoint) =>
      parseNcxNavPoint(archive, packageData.ncxPath!, navPoint),
    )
    .filter((item): item is EpubNavigationItem => item !== undefined);

  return items.length === 0 ? undefined : items;
}

function parseNavListItem(
  archive: EpubArchive,
  navPath: string,
  item: HtmlNode,
): EpubNavigationItem | undefined {
  const label = findHtmlLabelNode(item);
  const title =
    label === undefined ? undefined : normalizeText(collectHtmlText(label));
  const href =
    label !== undefined && getHtmlTagName(label) === "a"
      ? label.attribs?.href
      : undefined;
  const resolved = resolveHtmlHref(archive, navPath, href);
  const children = getHtmlElementChildren(item)
    .filter((child) => getHtmlTagName(child) === "ol")
    .flatMap((ol) => getHtmlElementChildren(ol))
    .filter((child) => getHtmlTagName(child) === "li")
    .map((li) => parseNavListItem(archive, navPath, li))
    .filter((child): child is EpubNavigationItem => child !== undefined);

  if (
    title === undefined &&
    resolved.path === undefined &&
    children.length === 0
  ) {
    return undefined;
  }

  return {
    title,
    path: resolved.path,
    fragment: resolved.fragment,
    children,
  };
}

function parseNcxNavPoint(
  archive: EpubArchive,
  ncxPath: string,
  navPoint: XmlElement,
): EpubNavigationItem | undefined {
  const navLabel = findChild(navPoint, "navLabel");
  const textElement =
    navLabel === undefined ? undefined : findChild(navLabel, "text");
  const title =
    textElement === undefined
      ? undefined
      : normalizeText(getDescendantText(textElement));
  const contentElement = findChild(navPoint, "content");
  const resolved = resolveXmlHref(
    archive,
    ncxPath,
    getAttribute(contentElement ?? navPoint, "src"),
  );
  const children = findChildren(navPoint, "navPoint")
    .map((child) => parseNcxNavPoint(archive, ncxPath, child))
    .filter((child): child is EpubNavigationItem => child !== undefined);

  if (
    title === undefined &&
    resolved.path === undefined &&
    children.length === 0
  ) {
    return undefined;
  }

  return {
    title,
    path: resolved.path,
    fragment: resolved.fragment,
    children,
  };
}

function buildSpineNavigation(
  packageData: EpubPackageData,
  referencedPaths: ReadonlySet<string>,
): readonly EpubNavigationItem[] {
  return packageData.spine
    .filter(
      (item) => !isNonContentSpineItem(packageData, item.path, referencedPaths),
    )
    .filter((item) => !referencedPaths.has(item.path))
    .map((item) => ({
      title: getFallbackTitle(item.path),
      path: item.path,
      fragment: undefined,
      children: [],
    }));
}

function isNonContentSpineItem(
  packageData: EpubPackageData,
  path: string,
  referencedPaths: ReadonlySet<string>,
): boolean {
  if (packageData.guideNonContentPaths.has(path)) {
    return true;
  }

  const lowerName = posix.basename(path).toLowerCase();
  if (packageData.navPath === path) {
    return true;
  }

  return NON_CONTENT_FILE_NAMES.has(lowerName) && !referencedPaths.has(path);
}

function collectReferencedPaths(
  items: readonly EpubNavigationItem[],
): ReadonlySet<string> {
  const paths = new Set<string>();

  for (const item of items) {
    if (item.path !== undefined) {
      paths.add(item.path);
    }

    for (const childPath of collectReferencedPaths(item.children)) {
      paths.add(childPath);
    }
  }

  return paths;
}

function resolveHtmlHref(
  archive: EpubArchive,
  basePath: string,
  href: string | undefined,
): {
  readonly path: string | undefined;
  readonly fragment: string | undefined;
} {
  if (href === undefined || href.trim() === "") {
    return { path: undefined, fragment: undefined };
  }

  const { path, fragment } = splitHref(href);

  return {
    path: path === "" ? undefined : archive.resolveRelativePath(basePath, path),
    fragment,
  };
}

function resolveXmlHref(
  archive: EpubArchive,
  basePath: string,
  href: string | undefined,
): {
  readonly path: string | undefined;
  readonly fragment: string | undefined;
} {
  if (href === undefined || href.trim() === "") {
    return { path: undefined, fragment: undefined };
  }

  const { path, fragment } = splitHref(href);

  return {
    path: path === "" ? undefined : archive.resolveRelativePath(basePath, path),
    fragment,
  };
}

function findFirstHtmlElement(
  node: HtmlNode,
  predicate: (element: HtmlNode) => boolean,
): HtmlNode | undefined {
  if (isHtmlElement(node) && predicate(node)) {
    return node;
  }

  for (const child of node.children ?? []) {
    const found = findFirstHtmlElement(child, predicate);
    if (found !== undefined) {
      return found;
    }
  }

  return undefined;
}

function findHtmlLabelNode(node: HtmlNode): HtmlNode | undefined {
  for (const child of getHtmlElementChildren(node)) {
    const tagName = getHtmlTagName(child);
    if (tagName === "a" || tagName === "span") {
      return child;
    }
  }

  for (const child of getHtmlElementChildren(node)) {
    if (getHtmlTagName(child) === "ol") {
      continue;
    }

    const nested = findHtmlLabelNode(child);
    if (nested !== undefined) {
      return nested;
    }
  }

  return undefined;
}

function collectHtmlText(node: HtmlNode): string {
  if (node.type === "text") {
    return node.data ?? "";
  }

  return (node.children ?? []).map(collectHtmlText).join("");
}

function getHtmlElementChildren(node: HtmlNode): readonly HtmlNode[] {
  return (node.children ?? []).filter(isHtmlElement);
}

function isHtmlElement(node: HtmlNode): boolean {
  return node.type === "tag" || node.type === "script" || node.type === "style";
}

function getHtmlTagName(node: HtmlNode): string | undefined {
  return node.name?.toLowerCase();
}

function getFallbackTitle(path: string): string | undefined {
  const stem = basename(path, extname(path)).trim();

  return stem === "" ? undefined : stem;
}

function normalizeText(text: string): string | undefined {
  const normalized = text.replace(/\s+/gu, " ").trim();

  return normalized === "" ? undefined : normalized;
}
