import type { ArchiveFindLensHint } from "./types.js";

export const DEFAULT_FIND_LIMIT = 20;
export const TEXT_ONLY_SEARCH_CACHE_WINDOW = 100;
export const ARCHIVE_ROOT_ID = "meta:root";

export const BROAD_FIND_LENS_HINT = {
  lenses: {
    chapter: "book outline and chapter titles",
    chunk: "source text ranges",
    entity: "indexed entities",
    node: "topology / LLM Wiki structure",
    triple: "knowledge graph statements",
  },
  message:
    "Choose scope URI lenses such as /chapter, /chunk, /entity, or /triple for broad search.",
} satisfies ArchiveFindLensHint;
