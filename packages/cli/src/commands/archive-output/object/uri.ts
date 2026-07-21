export function isTextStreamOutputType(type: string | undefined): boolean {
  return type === "source" || type === "summary";
}

export function getTextStreamOutputType(
  uri: string,
): "source" | "summary" | undefined {
  const match =
    /^wikg:\/\/chapter\/[1-9][0-9]*\/(source|summary)(?:#.*)?$/u.exec(uri);

  return match?.[1] as "source" | "summary" | undefined;
}

export function toWikiGraphUri(id: string): string {
  const [type, first, second] = id.split(":");

  switch (type) {
    case "chapter":
      return `wikg://chapter/${first ?? ""}`;
    case "chapter-title":
      return `wikg://chapter/${first ?? ""}/title`;
    case "fragment":
      return `wikg://chapter/${first ?? ""}/source/${second ?? "0"}`;
    case "meta":
      return "wikg://";
    case "node":
      return `wikg://chunk/${first ?? ""}`;
    case "summary":
      return `wikg://chapter/${first ?? ""}/summary`;
    default:
      return id;
  }
}
