export function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function normalizeLanguage(language: string | null): string {
  const normalized = language?.trim();

  return normalized === undefined || normalized === "" ? "und" : normalized;
}
