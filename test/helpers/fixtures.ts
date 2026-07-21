import { fileURLToPath } from "url";
import { dirname, join } from "path";

import type {
  SourceSection,
  SourceTextStream,
} from "../../packages/core/src/text/source/index.js";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));

export function getFixturePath(fileName: string): string {
  return join(TEST_DIR, "..", "fixtures", "sources", fileName);
}

export async function readStreamText(
  stream: SourceTextStream,
): Promise<string> {
  let text = "";

  for await (const chunk of stream) {
    text += chunk;
  }

  return text;
}

export function collectSectionTitles(
  sections: readonly SourceSection[],
): readonly string[] {
  const titles: string[] = [];

  for (const section of sections) {
    titles.push(section.title ?? "");
    titles.push(...collectSectionTitles(section.children));
  }

  return titles;
}
