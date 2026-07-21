import { DomUtils, parseDocument } from "htmlparser2";

import { asRecord, getString } from "./json.js";

const TITLE_URI_PREFIX = "wikigraph-title://";

interface HtmlElement {
  readonly attribs: Record<string, string | undefined>;
  readonly children?: readonly unknown[];
  readonly name: string;
}

export function replaceTitleUriWithQidUri(
  text: string,
  titleToQid: ReadonlyMap<string, string>,
): string {
  return text.replace(
    /\[\[([^\]|]+)\|wikigraph-title:\/\/([^\]\s]+)\]\]/gu,
    (_match: string, label: string, encodedTitle: string) => {
      const title = decodeURIComponent(encodedTitle);
      const qid = titleToQid.get(title);

      return qid === undefined ? label : `[[${label}|wikg://qid=${qid}]]`;
    },
  );
}

export function renderDisambiguationHtml(html: string | undefined): {
  readonly linkedTitles: readonly string[];
  readonly text: string;
} {
  if (html === undefined || html.trim() === "") {
    return {
      linkedTitles: [],
      text: "",
    };
  }

  const linkedTitles = new Set<string>();
  const document = parseDocument(html);
  const text = renderNodes(DomUtils.getChildren(document), {
    linkedTitles,
    listDepth: 0,
  })
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();

  return {
    linkedTitles: [...linkedTitles],
    text,
  };
}

function renderNodes(
  nodes: readonly unknown[],
  context: {
    readonly linkedTitles: Set<string>;
    readonly listDepth: number;
  },
): string {
  return nodes.map((node) => renderNode(node, context)).join("");
}

function renderNode(
  node: unknown,
  context: {
    readonly linkedTitles: Set<string>;
    readonly listDepth: number;
  },
): string {
  const record = asRecord(node);
  const nodeType = getString(record.type);

  if (nodeType === "text") {
    return normalizeInlineText(getString(record.data) ?? "");
  }
  if (nodeType !== "tag" && nodeType !== "script" && nodeType !== "style") {
    return "";
  }

  const element = node as HtmlElement;
  if (shouldSkipElement(element)) {
    return "";
  }

  const name = element.name.toLowerCase();

  if (name === "a") {
    return renderLink(element, context);
  }
  if (/^h[1-6]$/u.test(name)) {
    const level = Math.min(6, Math.max(1, Number(name.slice(1))));
    const marker = "=".repeat(level);
    const heading = renderNodes(element.children ?? [], context).trim();

    return heading === "" ? "" : `\n${marker} ${heading} ${marker}\n`;
  }
  if (name === "li") {
    const indent = "  ".repeat(Math.max(0, context.listDepth - 1));
    const content = renderNodes(element.children ?? [], {
      ...context,
      listDepth: context.listDepth + 1,
    }).trim();

    return content === "" ? "" : `\n${indent}* ${content}`;
  }
  if (name === "ul" || name === "ol") {
    return `${renderNodes(element.children ?? [], context)}\n`;
  }
  if (isBlockElement(name)) {
    const content = renderNodes(element.children ?? [], context).trim();

    return content === "" ? "" : `\n${content}\n`;
  }

  return renderNodes(element.children ?? [], context);
}

function renderLink(
  node: HtmlElement,
  context: {
    readonly linkedTitles: Set<string>;
    readonly listDepth: number;
  },
): string {
  const content = renderNodes(node.children ?? [], context).trim();
  const title = extractWikiLinkTitle(node);

  if (title === undefined) {
    return content;
  }

  context.linkedTitles.add(title);

  return `[[${content === "" ? title : content}|${TITLE_URI_PREFIX}${encodeURIComponent(title)}]]`;
}

function extractWikiLinkTitle(node: HtmlElement): string | undefined {
  const title = node.attribs.title;
  const href = node.attribs.href;

  if (title !== undefined && title !== "" && !title.includes(":")) {
    return title;
  }
  if (href === undefined || !href.startsWith("/wiki/")) {
    return undefined;
  }

  const decoded = decodeURIComponent(href.slice("/wiki/".length)).replaceAll(
    "_",
    " ",
  );

  return decoded === "" || decoded.includes(":") ? undefined : decoded;
}

function shouldSkipElement(node: HtmlElement): boolean {
  const name = node.name.toLowerCase();

  if (["script", "style", "table", "sup"].includes(name)) {
    return true;
  }

  const className = node.attribs.class ?? "";

  return [
    "catlinks",
    "metadata",
    "mw-editsection",
    "mw-empty-elt",
    "navbox",
    "noprint",
    "reference",
    "reflist",
    "shortdescription",
    "toc",
  ].some((item) => className.split(/\s+/u).includes(item));
}

function isBlockElement(name: string): boolean {
  return ["blockquote", "br", "dd", "div", "dl", "dt", "p", "section"].includes(
    name,
  );
}

function normalizeInlineText(value: string): string {
  return value.replace(/\s+/gu, " ");
}
