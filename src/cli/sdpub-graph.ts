import {
  findGraphPath,
  getGraphEvidence,
  getGraphNode,
  getGraphStatus,
  listGraphNeighbors,
  listGraphNodes,
  searchGraphNodes,
  type GraphEdge,
  type GraphEvidenceLine,
  type GraphNeighbor,
  type GraphNode,
  type GraphPathStep,
  type GraphSearchHit,
} from "../facade/index.js";
import { SpineDigestFile } from "../facade/spine-digest-file.js";

import type { CLISdpubGraphArguments } from "./args.js";
import { writeTextToStdout } from "./io.js";

const DEFAULT_LOG_LIMIT = 20;
const SHOW_EVIDENCE_LIMIT = 3;

export async function runSdpubGraphCommand(
  args: CLISdpubGraphArguments,
): Promise<void> {
  await new SpineDigestFile(args.path).openEditableSession(async (document) => {
    switch (args.action) {
      case "status":
        await writeTextToStdout(
          formatStatus(await getGraphStatus(document, args.chapterId)),
        );
        return;
      case "log":
        await writeTextToStdout(
          formatLog(
            await listGraphNodes(document, args.chapterId),
            args.limit ?? DEFAULT_LOG_LIMIT,
          ),
        );
        return;
      case "show": {
        const [node, neighbors, evidence] = await Promise.all([
          getGraphNode(document, args.chapterId, args.nodeId!),
          listGraphNeighbors(document, args.chapterId, args.nodeId!),
          getGraphEvidence(document, args.chapterId, args.nodeId!),
        ]);

        await writeTextToStdout(formatShow(node, neighbors, evidence));
        return;
      }
      case "grep":
        await writeTextToStdout(
          formatSearchHits(
            await searchGraphNodes(document, args.chapterId, args.pattern!),
          ),
        );
        return;
      case "neighbors":
        await writeTextToStdout(
          formatNeighbors(
            args.nodeId!,
            await listGraphNeighbors(document, args.chapterId, args.nodeId!),
          ),
        );
        return;
      case "blame":
        await writeTextToStdout(
          formatEvidence(
            args.nodeId!,
            await getGraphEvidence(document, args.chapterId, args.nodeId!),
          ),
        );
        return;
      case "path":
        await writeTextToStdout(
          formatPath(
            args.fromNodeId!,
            args.toNodeId!,
            await findGraphPath(
              document,
              args.chapterId,
              args.fromNodeId!,
              args.toNodeId!,
            ),
          ),
        );
        return;
    }
  });
}

function formatStatus(status: {
  readonly chapterId: number;
  readonly edgeCount: number;
  readonly graphReady: boolean;
  readonly nodeCount: number;
}): string {
  return [
    `Chapter: ${status.chapterId}`,
    `Graph: ${status.graphReady ? "yes" : "no"}`,
    `Nodes: ${status.nodeCount}`,
    `Edges: ${status.edgeCount}`,
    "",
  ].join("\n");
}

function formatLog(nodes: readonly GraphNode[], limit: number): string {
  if (nodes.length === 0) {
    return "No graph nodes.\n";
  }

  return `${nodes.slice(0, limit).map(formatNodeOneLine).join("\n")}\n`;
}

function formatShow(
  node: GraphNode,
  neighbors: readonly GraphNeighbor[],
  evidence: readonly GraphEvidenceLine[],
): string {
  const lines = [
    formatNodeHeading(node),
    `Weight: ${formatWeight(node.weight)}`,
    `Words: ${node.wordsCount}`,
  ];

  appendOptional(lines, "Importance", node.importance);
  appendOptional(lines, "Retention", node.retention);
  lines.push("", "Content:", node.content, "");

  if (neighbors.length === 0) {
    lines.push("Neighbors:", "  [none]", "");
  } else {
    lines.push("Neighbors:");
    lines.push(...neighbors.slice(0, 10).map(formatNeighborLine));
    lines.push("");
  }

  if (evidence.length === 0) {
    lines.push("Evidence:", "  [none]");
  } else {
    lines.push("Evidence:");
    lines.push(
      ...evidence
        .slice(0, SHOW_EVIDENCE_LIMIT)
        .map((line) => `  ${formatSentenceId(line.sentenceId)} ${line.text}`),
    );
    if (evidence.length > SHOW_EVIDENCE_LIMIT) {
      lines.push(`  ... ${evidence.length - SHOW_EVIDENCE_LIMIT} more`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function formatSearchHits(hits: readonly GraphSearchHit[]): string {
  if (hits.length === 0) {
    return "No matches.\n";
  }

  return `${hits
    .map(
      (hit) =>
        `${formatNodeOneLine(hit.node)} matches:${hit.matchedFields.join(",")}`,
    )
    .join("\n")}\n`;
}

function formatNeighbors(
  nodeId: number,
  neighbors: readonly GraphNeighbor[],
): string {
  if (neighbors.length === 0) {
    return `Node ${nodeId} has no neighbors.\n`;
  }

  return `${neighbors.map(formatNeighborLine).join("\n")}\n`;
}

function formatEvidence(
  nodeId: number,
  evidence: readonly GraphEvidenceLine[],
): string {
  if (evidence.length === 0) {
    return `Node ${nodeId} has no source evidence.\n`;
  }

  return `${evidence
    .map((line) => `${formatSentenceId(line.sentenceId)} ${line.text}`)
    .join("\n")}\n`;
}

function formatPath(
  fromNodeId: number,
  toNodeId: number,
  steps: readonly GraphPathStep[],
): string {
  if (steps.length === 0) {
    return `No path from ${fromNodeId} to ${toNodeId}.\n`;
  }

  const lines: string[] = [];

  for (const [index, step] of steps.entries()) {
    if (index > 0) {
      lines.push(`  ${formatPathEdge(step.edge)}`);
    }
    lines.push(formatNodeOneLine(step.node));
  }

  return `${lines.join("\n")}\n`;
}

function formatNodeOneLine(node: GraphNode): string {
  return `[${node.id}] ${formatWeight(node.weight)} ${node.label} - ${node.content}`;
}

function formatNodeHeading(node: GraphNode): string {
  return `[${node.id}] ${node.label}`;
}

function formatNeighborLine(neighbor: GraphNeighbor): string {
  const arrow = neighbor.direction === "incoming" ? "<-" : "->";
  const edgeNodeId =
    neighbor.direction === "incoming"
      ? neighbor.edge.fromId
      : neighbor.edge.toId;

  return `  ${arrow} [${edgeNodeId}] ${formatWeight(neighbor.edge.weight)} ${neighbor.node.label}`;
}

function formatPathEdge(edge: GraphEdge | undefined): string {
  if (edge === undefined) {
    return "->";
  }

  return `-> ${formatWeight(edge.weight)}`;
}

function formatSentenceId(sentenceId: readonly number[]): string {
  return sentenceId.join(".");
}

function formatWeight(value: number): string {
  return value.toFixed(3);
}

function appendOptional(
  lines: string[],
  label: string,
  value: string | undefined,
): void {
  if (value !== undefined) {
    lines.push(`${label}: ${value}`);
  }
}
