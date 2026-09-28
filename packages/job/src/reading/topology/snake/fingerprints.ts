import { getReadingEdgeKey } from "../weights.js";
import { DECAY_FACTOR, DEFAULT_LINK_STRENGTH_WEIGHT } from "./constants.js";
import {
  createBooleanRecord,
  createNumberMatrixRecord,
  createNumberRecord,
} from "./records.js";
import type { DetectorGraph, Fingerprints } from "./types.js";

export function computeAllFingerprints(graph: DetectorGraph): Fingerprints {
  const fingerprints = createNumberMatrixRecord();

  for (const startChunkId of graph.sortedChunkIds) {
    const concentrations = createNumberRecord();
    let currentLayer = [startChunkId];
    const visitedChunkIds = createBooleanRecord();

    concentrations[String(startChunkId)] = 1;
    visitedChunkIds[String(startChunkId)] = true;

    while (currentLayer.length > 0) {
      const nextLayerConcentrations = createNumberRecord();

      for (const currentChunkId of currentLayer) {
        const currentConcentration =
          concentrations[String(currentChunkId)] ?? 0;
        let totalWeight = 0;
        const neighbors: Array<readonly [number, number]> = [];

        for (const edge of graph.incomingEdgesByChunkId[
          String(currentChunkId)
        ] ?? []) {
          if (visitedChunkIds[String(edge.fromId)] === true) {
            continue;
          }

          const weight =
            graph.fingerprintEdgeWeightsByKey[
              getReadingEdgeKey(edge.fromId, currentChunkId)
            ] ??
            graph.fingerprintEdgeWeightsByKey[
              getReadingEdgeKey(currentChunkId, edge.fromId)
            ] ??
            DEFAULT_LINK_STRENGTH_WEIGHT;

          neighbors.push([edge.fromId, weight]);
          totalWeight += weight;
        }

        for (const edge of graph.outgoingEdgesByChunkId[
          String(currentChunkId)
        ] ?? []) {
          if (visitedChunkIds[String(edge.toId)] === true) {
            continue;
          }

          const weight =
            graph.fingerprintEdgeWeightsByKey[
              getReadingEdgeKey(currentChunkId, edge.toId)
            ] ??
            graph.fingerprintEdgeWeightsByKey[
              getReadingEdgeKey(edge.toId, currentChunkId)
            ] ??
            DEFAULT_LINK_STRENGTH_WEIGHT;

          neighbors.push([edge.toId, weight]);
          totalWeight += weight;
        }

        if (totalWeight <= 0) {
          continue;
        }

        for (const [neighborChunkId, weight] of neighbors) {
          const contribution =
            currentConcentration * (weight / totalWeight) * DECAY_FACTOR;

          nextLayerConcentrations[String(neighborChunkId)] =
            (nextLayerConcentrations[String(neighborChunkId)] ?? 0) +
            contribution;
        }
      }

      currentLayer = Object.keys(nextLayerConcentrations).map(Number);

      for (const nextChunkId of currentLayer) {
        concentrations[String(nextChunkId)] =
          nextLayerConcentrations[String(nextChunkId)] ?? 0;
        visitedChunkIds[String(nextChunkId)] = true;
      }
    }

    const totalConcentration = Object.values(concentrations).reduce(
      (sum, concentration) => sum + concentration,
      0,
    );

    if (totalConcentration > 0) {
      for (const chunkId of Object.keys(concentrations)) {
        concentrations[chunkId] =
          (concentrations[chunkId] ?? 0) / totalConcentration;
      }
    }

    fingerprints[String(startChunkId)] = concentrations;
  }

  return fingerprints;
}

export function validateFingerprints(fingerprints: Fingerprints): void {
  const firstChunkId = Object.keys(fingerprints)[0];

  if (firstChunkId === undefined) {
    return;
  }

  const referenceChunkIds = Object.keys(
    fingerprints[firstChunkId] ?? {},
  ).sort();

  for (const [chunkId, fingerprint] of Object.entries(fingerprints)) {
    const fingerprintChunkIds = Object.keys(fingerprint).sort();

    if (
      fingerprintChunkIds.length !== referenceChunkIds.length ||
      fingerprintChunkIds.some(
        (targetChunkId, index) => targetChunkId !== referenceChunkIds[index],
      )
    ) {
      throw new Error(`Fingerprint structure mismatch for chunk ${chunkId}`);
    }
  }
}
