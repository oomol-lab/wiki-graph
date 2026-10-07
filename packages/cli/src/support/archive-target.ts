import {
  parseLocatedWikiGraphUri,
  type WikiGraphArchiveTarget,
} from "wiki-graph-sdk";

/** Convert the CLI's explicit URI syntax into the SDK's discriminated target. */
export function parseCLIArchiveTarget(locator: string): WikiGraphArchiveTarget {
  if (locator.startsWith("wikg://lib/")) {
    return { kind: "library", uri: locator };
  }
  if (!locator.includes("://")) {
    return { kind: "standalone", path: locator };
  }
  const parsed = parseLocatedWikiGraphUri(locator);
  return {
    kind: "standalone",
    path: parsed.archivePath ?? locator,
    ...(parsed.objectUri === undefined ? {} : { objectUri: parsed.objectUri }),
  };
}
