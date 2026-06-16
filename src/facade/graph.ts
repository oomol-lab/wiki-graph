import type {
  ChunkImportance,
  ChunkRecord,
  ChunkRetention,
  KnowledgeEdgeRecord,
  ReadonlyDocument,
  SentenceId,
} from "../document/index.js";

export interface GraphNode {
  readonly content: string;
  readonly id: number;
  readonly importance?: ChunkImportance;
  readonly label: string;
  readonly retention?: ChunkRetention;
  readonly sentenceIds: readonly SentenceId[];
  readonly weight: number;
  readonly wordsCount: number;
}

export interface GraphEdge {
  readonly fromId: number;
  readonly strength?: string;
  readonly toId: number;
  readonly weight: number;
}

export interface GraphEvidenceLine {
  readonly sentenceId: SentenceId;
  readonly text: string;
}

export interface GraphStatus {
  readonly chapterId: number;
  readonly edgeCount: number;
  readonly graphReady: boolean;
  readonly nodeCount: number;
}

export interface GraphSearchHit {
  readonly node: GraphNode;
  readonly matchedFields: readonly GraphSearchField[];
}

export type GraphSearchField = "content" | "evidence" | "label";

export interface GraphNeighbor {
  readonly direction: "incoming" | "outgoing";
  readonly edge: GraphEdge;
  readonly node: GraphNode;
}

export interface GraphPathStep {
  readonly edge?: GraphEdge;
  readonly node: GraphNode;
}

export async function getGraphStatus(
  document: ReadonlyDocument,
  chapterId: number,
): Promise<GraphStatus> {
  await requireChapter(document, chapterId);
  const [serial, nodes, edges] = await Promise.all([
    document.serials.getById(chapterId),
    listGraphNodes(document, chapterId),
    document.knowledgeEdges.listBySerial(chapterId),
  ]);

  return {
    chapterId,
    edgeCount: edges.length,
    graphReady: serial?.topologyReady === true,
    nodeCount: nodes.length,
  };
}

export async function listGraphNodes(
  document: ReadonlyDocument,
  chapterId: number,
): Promise<readonly GraphNode[]> {
  await requireChapter(document, chapterId);
  const chunks = await document.chunks.listBySerial(chapterId);

  return chunks.map(formatGraphNode).sort(compareNodeByWeightDescending);
}

export async function getGraphNode(
  document: ReadonlyDocument,
  chapterId: number,
  nodeId: number,
): Promise<GraphNode> {
  const node = formatGraphNode(
    await requireChapterNode(document, chapterId, nodeId),
  );

  return node;
}

export async function searchGraphNodes(
  document: ReadonlyDocument,
  chapterId: number,
  pattern: string,
): Promise<readonly GraphSearchHit[]> {
  const normalizedPattern = pattern.trim().toLowerCase();

  if (normalizedPattern === "") {
    return [];
  }

  const nodes = await listGraphNodes(document, chapterId);
  const hits: GraphSearchHit[] = [];

  for (const node of nodes) {
    const evidence = await getGraphEvidence(document, chapterId, node.id);
    const matchedFields: GraphSearchField[] = [];

    if (node.label.toLowerCase().includes(normalizedPattern)) {
      matchedFields.push("label");
    }
    if (node.content.toLowerCase().includes(normalizedPattern)) {
      matchedFields.push("content");
    }
    if (
      evidence.some((line) =>
        line.text.toLowerCase().includes(normalizedPattern),
      )
    ) {
      matchedFields.push("evidence");
    }

    if (matchedFields.length > 0) {
      hits.push({ matchedFields, node });
    }
  }

  return hits;
}

export async function listGraphNeighbors(
  document: ReadonlyDocument,
  chapterId: number,
  nodeId: number,
): Promise<readonly GraphNeighbor[]> {
  await requireChapterNode(document, chapterId, nodeId);
  const [incoming, outgoing] = await Promise.all([
    document.knowledgeEdges.listIncoming(nodeId),
    document.knowledgeEdges.listOutgoing(nodeId),
  ]);
  const neighbors = await Promise.all([
    ...incoming.map(async (edge) => ({
      direction: "incoming" as const,
      edge: formatGraphEdge(edge),
      node: formatGraphNode(
        await requireChapterNode(document, chapterId, edge.fromId),
      ),
    })),
    ...outgoing.map(async (edge) => ({
      direction: "outgoing" as const,
      edge: formatGraphEdge(edge),
      node: formatGraphNode(
        await requireChapterNode(document, chapterId, edge.toId),
      ),
    })),
  ]);

  return neighbors.sort(compareNeighbor);
}

export async function getGraphEvidence(
  document: ReadonlyDocument,
  chapterId: number,
  nodeId: number,
): Promise<readonly GraphEvidenceLine[]> {
  const node = await requireChapterNode(document, chapterId, nodeId);
  const lines = await Promise.all(
    node.sentenceIds.map(async (sentenceId) => ({
      sentenceId,
      text: await document.getSentence(sentenceId),
    })),
  );

  return lines;
}

export async function findGraphPath(
  document: ReadonlyDocument,
  chapterId: number,
  fromNodeId: number,
  toNodeId: number,
): Promise<readonly GraphPathStep[]> {
  await requireChapterNode(document, chapterId, fromNodeId);
  await requireChapterNode(document, chapterId, toNodeId);

  if (fromNodeId === toNodeId) {
    return [{ node: await getGraphNode(document, chapterId, fromNodeId) }];
  }

  const edges = (await document.knowledgeEdges.listBySerial(chapterId)).map(
    formatGraphEdge,
  );
  const outgoing = new Map<number, GraphEdge[]>();

  for (const edge of edges) {
    const existing = outgoing.get(edge.fromId) ?? [];

    existing.push(edge);
    outgoing.set(edge.fromId, existing);
  }

  const visited = new Set<number>([fromNodeId]);
  const queue: number[] = [fromNodeId];
  const previous = new Map<
    number,
    { readonly edge: GraphEdge; readonly id: number }
  >();

  while (queue.length > 0) {
    const currentId = queue.shift()!;

    for (const edge of outgoing.get(currentId) ?? []) {
      if (visited.has(edge.toId)) {
        continue;
      }

      visited.add(edge.toId);
      previous.set(edge.toId, { edge, id: currentId });

      if (edge.toId === toNodeId) {
        return await buildPathSteps(
          document,
          chapterId,
          fromNodeId,
          toNodeId,
          previous,
        );
      }

      queue.push(edge.toId);
    }
  }

  return [];
}

async function buildPathSteps(
  document: ReadonlyDocument,
  chapterId: number,
  fromNodeId: number,
  toNodeId: number,
  previous: ReadonlyMap<
    number,
    { readonly edge: GraphEdge; readonly id: number }
  >,
): Promise<readonly GraphPathStep[]> {
  const steps: Array<{ readonly edge?: GraphEdge; readonly nodeId: number }> = [
    { nodeId: toNodeId },
  ];
  let currentId = toNodeId;

  while (currentId !== fromNodeId) {
    const previousStep = previous.get(currentId);

    if (previousStep === undefined) {
      return [];
    }

    steps.push({ edge: previousStep.edge, nodeId: previousStep.id });
    currentId = previousStep.id;
  }

  steps.reverse();

  return await Promise.all(
    steps.map(async (step) => ({
      ...(step.edge === undefined ? {} : { edge: step.edge }),
      node: await getGraphNode(document, chapterId, step.nodeId),
    })),
  );
}

async function requireChapter(
  document: ReadonlyDocument,
  chapterId: number,
): Promise<void> {
  const serial = await document.serials.getById(chapterId);

  if (serial === undefined) {
    throw new Error(
      `Chapter ${chapterId} does not exist. Use \`spinedigest list <archive.sdpub> --type chapter\` to discover chapter ids.`,
    );
  }
}

async function requireChapterNode(
  document: ReadonlyDocument,
  chapterId: number,
  nodeId: number,
): Promise<ChunkRecord> {
  const chunk = await document.chunks.getById(nodeId);

  if (chunk === undefined || chunk.sentenceId[0] !== chapterId) {
    throw new Error(
      `Graph node ${nodeId} does not exist in chapter ${chapterId}. Use \`spinedigest list <archive.sdpub> --type node --chapter ${chapterId}\` to discover node ids.`,
    );
  }

  return chunk;
}

function formatGraphNode(chunk: ChunkRecord): GraphNode {
  return {
    content: chunk.content,
    id: chunk.id,
    label: chunk.label,
    sentenceIds: chunk.sentenceIds,
    weight: chunk.weight,
    wordsCount: chunk.wordsCount,
    ...(chunk.importance === undefined ? {} : { importance: chunk.importance }),
    ...(chunk.retention === undefined ? {} : { retention: chunk.retention }),
  };
}

function formatGraphEdge(edge: KnowledgeEdgeRecord): GraphEdge {
  return {
    fromId: edge.fromId,
    toId: edge.toId,
    weight: edge.weight,
    ...(edge.strength === undefined ? {} : { strength: edge.strength }),
  };
}

function compareNodeByWeightDescending(
  left: GraphNode,
  right: GraphNode,
): number {
  return right.weight - left.weight || left.id - right.id;
}

function compareNeighbor(left: GraphNeighbor, right: GraphNeighbor): number {
  if (left.direction !== right.direction) {
    return left.direction === "incoming" ? -1 : 1;
  }

  return right.edge.weight - left.edge.weight || left.node.id - right.node.id;
}
