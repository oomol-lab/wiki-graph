import type { ChunkRecord, ReadingEdgeRecord } from "../../document/index.js";

export function createBooleanRecord(): Record<string, boolean | undefined> {
  return Object.create(null) as Record<string, boolean | undefined>;
}

export function createChunkRecord(): Record<
  string,
  ChunkRecord | undefined
> {
  return Object.create(null) as Record<string, ChunkRecord | undefined>;
}

export function createEdgeRecord(): Record<
  string,
  ReadingEdgeRecord | undefined
> {
  return Object.create(null) as Record<string, ReadingEdgeRecord | undefined>;
}

export function createNumberListRecord(): Record<
  string,
  number[] | undefined
> {
  return Object.create(null) as Record<string, number[] | undefined>;
}

export function createNumberMatrixRecord(): Record<
  string,
  Record<string, number>
> {
  return Object.create(null) as Record<string, Record<string, number>>;
}

export function createNumberRecord(): Record<string, number> {
  return Object.create(null) as Record<string, number>;
}

export function createOptionalNumberRecord(): Record<
  string,
  number | undefined
> {
  return Object.create(null) as Record<string, number | undefined>;
}

export function createReadingEdgeListRecord(): Record<
  string,
  ReadingEdgeRecord[] | undefined
> {
  return Object.create(null) as Record<string, ReadingEdgeRecord[] | undefined>;
}
