import { WIKI_GRAPH_URI_PREFIX } from "../../../common/wiki-graph-uri.js";

export function isWikiGraphObjectUri(uri: string): boolean {
  return uri.startsWith(WIKI_GRAPH_URI_PREFIX);
}

export function normalizeWikiGraphObjectUri(uri: string): string {
  return uri;
}
