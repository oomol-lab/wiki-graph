import {
  formatWikiGraphCommandUri,
  type ArchiveFindEvidencePreview,
  type ArchivePage,
} from "wiki-graph-core";

import { formatCLIJSON, formatCliCommand } from "../../../support/index.js";
import {
  createEvidencePreviewObject,
  createPageObject,
} from "../object/objects.js";
import type { ArchiveOutputContext } from "../object/types.js";
import { toWikiGraphUri } from "../object/uri.js";
import { formatEvidencePreviewBlocks } from "./evidence.js";
import { formatPlainObject } from "./plain.js";

export async function formatEvidenceBackedPageText(
  uri: string,
  label: string,
  evidence: ArchiveFindEvidencePreview,
  context: ArchiveOutputContext,
): Promise<string> {
  if (context.evidenceLimit === undefined) {
    return [`${uri}`, label].join("\n");
  }

  return [
    `${uri}`,
    label,
    "",
    "Evidence:",
    ...formatEvidencePreviewBlocks(
      await createEvidencePreviewObject(evidence, {
        ...context,
        continuationKind: "evidence",
        targetUri: uri,
      }),
    ),
  ].join("\n");
}

export function appendEntityNextSteps(
  text: string,
  uri: string,
  archivePath: string,
): string {
  if (!isEntityOutputUri(uri)) {
    return text;
  }
  const entityUri = formatWikiGraphCommandUri(
    archivePath,
    uri.replace(/\/$/u, ""),
  );

  return [
    text,
    "",
    "Next:",
    `  ${formatCliCommand([entityUri, "evidence"])}`,
    `  ${formatCliCommand([entityUri, "related"])}`,
    `  ${formatCliCommand([`${entityUri}/wikipage`])}`,
  ].join("\n");
}

function isEntityOutputUri(uri: string): boolean {
  return /^wikg:\/\/(?:chapter\/[1-9][0-9]*\/)?entity\/Q[1-9][0-9]*\/?$/u.test(
    uri,
  );
}

export function formatEntityWikipageText(
  page: Extract<ArchivePage, { readonly type: "entity-wikipage" }>,
): string {
  return [
    page.id,
    "",
    ...formatEntityWikipageLocaleLines("zh", page.zh),
    "",
    ...formatEntityWikipageLocaleLines("en", page.en),
  ].join("\n");
}

function formatEntityWikipageLocaleLines(
  language: "en" | "zh",
  locale: Extract<ArchivePage, { readonly type: "entity-wikipage" }>[
    | "en"
    | "zh"],
): readonly string[] {
  if (locale === null) {
    return [`${language}: [missing]`];
  }

  return [
    `${locale.title}  ${locale.url}`,
    ...(locale.description === undefined ? [] : [locale.description]),
  ];
}

export function formatNeighborLines(
  neighbors: Extract<ArchivePage, { readonly type: "node" }>["neighbors"],
): string[] {
  if (neighbors.length === 0) {
    return ["  [none]"];
  }

  return neighbors.map((neighbor) => {
    const arrow = neighbor.direction === "incoming" ? "<-" : "->";

    return `  ${arrow} ${toWikiGraphUri(`node:${neighbor.node.id}`)}  ${neighbor.node.label}`;
  });
}

export function formatNodeLabels(
  nodes: readonly { readonly id: string; readonly title: string }[],
): string[] {
  if (nodes.length === 0) {
    return ["  [none]"];
  }

  return nodes.map((node) => `  ${node.id}  ${node.title}`);
}

export function formatSourceFragmentLines(
  fragments: Extract<ArchivePage, { readonly type: "node" }>["sourceFragments"],
): string[] {
  if (fragments.length === 0) {
    return ["  [none]"];
  }

  return fragments.flatMap((fragment) => [
    `  ${fragment.id}${fragment.truncated ? "  [excerpt]" : ""}`,
    ...fragment.text.split("\n").map((line) => `    ${line}`),
  ]);
}

export function formatPosition(
  position:
    | {
        readonly chapter: number;
        readonly fragment?: number;
      }
    | undefined,
): string {
  if (position === undefined) {
    return "[unknown]";
  }

  return [
    `chapter ${position.chapter}`,
    position.fragment === undefined
      ? undefined
      : `fragment ${position.fragment}`,
  ]
    .filter((part): part is string => part !== undefined)
    .join(", ");
}

export async function formatPackAnchor(
  anchor: ArchivePage,
  context: ArchiveOutputContext,
): Promise<string> {
  switch (anchor.type) {
    case "chapter-title":
    case "chapter":
      return formatPlainObject(await createPageObject(anchor, context));
    case "chapter-tree":
      return `${anchor.id} ${anchor.title}\n${formatCLIJSON(anchor.tree).trimEnd()}`;
    case "fragment":
      return `${anchor.id}\n${anchor.fragment.text}`;
    case "meta":
      return formatPlainObject(await createPageObject(anchor, context));
    case "state":
      return formatPlainObject(await createPageObject(anchor, context));
    case "node":
      return [
        `${anchor.id} ${anchor.title}`,
        "",
        "Generated Node Summary:",
        anchor.generatedNodeSummary,
        "",
        "Source Fragments:",
        ...formatSourceFragmentLines(anchor.sourceFragments),
      ].join("\n");
    case "summary":
      return `${anchor.id} ${anchor.title}\n${anchor.content}`;
    case "entity":
      return await formatEvidenceBackedPageText(
        anchor.id,
        anchor.label,
        anchor.evidence,
        context,
      );
    case "entity-wikipage":
      return formatEntityWikipageText(anchor);
    case "triple":
      return await formatEvidenceBackedPageText(
        anchor.id,
        anchor.label,
        anchor.evidence,
        context,
      );
  }
}

export function truncateToBudget(text: string, budget: number): string {
  if (text.length <= budget) {
    return text;
  }

  return `${text.slice(0, Math.max(0, budget - 20))}\n[truncated]`;
}
