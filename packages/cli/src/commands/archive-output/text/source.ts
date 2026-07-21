import type { ArchiveOutputSource } from "../object/types.js";

export function formatSourceObject(source: ArchiveOutputSource): string {
  return formatSourceCitationBlock(source.uri, source.text);
}

export function formatSourceCitationBlock(uri: string, text: string): string {
  return [`@@ ${uri} @@`, normalizeSourceText(text)].join("\n");
}

function normalizeSourceText(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");

  while (lines.length > 0 && lines[0]?.trim() === "") {
    lines.shift();
  }
  while (lines.length > 0 && lines.at(-1)?.trim() === "") {
    lines.pop();
  }

  const normalizedLines: string[] = [];
  let previousLineWasBlank = false;

  for (const line of lines) {
    if (line.trim() === "") {
      if (!previousLineWasBlank) {
        normalizedLines.push("");
      }
      previousLineWasBlank = true;
      continue;
    }

    normalizedLines.push(line);
    previousLineWasBlank = false;
  }

  return normalizedLines.join("\n");
}
