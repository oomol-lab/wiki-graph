import type { ArchivePack } from "wiki-graph-core";

import { formatCLIJSON, writeTextToStdout } from "../../../support/index.js";
import {
  formatFindObject,
  formatPackAnchor,
  truncateToBudget,
} from "../text/index.js";
import { writeJSONL } from "./jsonl.js";
import { createListObject, createPackObject } from "../object/objects.js";
import { DEFAULT_GET_EVIDENCE_LIMIT } from "../object/types.js";
import type { ArchiveOutputContext, ResultFormat } from "../object/types.js";

export async function writePack(
  pack: ArchivePack,
  context: ArchiveOutputContext,
  format: ResultFormat,
): Promise<void> {
  const packContext =
    context.evidenceDisabled === true
      ? context
      : {
          ...context,
          evidenceLimit: context.evidenceLimit ?? DEFAULT_GET_EVIDENCE_LIMIT,
        };

  if (format === "json") {
    await writeTextToStdout(
      formatCLIJSON(await createPackObject(pack, packContext)),
    );
    return;
  }
  if (format === "jsonl") {
    await writeJSONL([await createPackObject(pack, packContext)]);
    return;
  }

  const lines = [
    `Pack Budget: ${pack.budget}`,
    "",
    "# Anchor",
    await formatPackAnchor(pack.anchor, packContext),
    "",
    "# Related",
    (
      await Promise.all(
        pack.related.map(async (item) =>
          formatFindObject(await createListObject(item, packContext)),
        ),
      )
    ).join("\n\n"),
  ];

  await writeTextToStdout(
    `${truncateToBudget(lines.join("\n"), pack.budget)}\n`,
  );
}
