import {
  formatCLIJSONLine,
  writeTextToStdout,
} from "../../../support/index.js";

export async function writeJSONL(items: readonly unknown[]): Promise<void> {
  await writeTextToStdout(
    items.map((item) => formatCLIJSONLine(item)).join("") +
      (items.length === 0 ? "" : ""),
  );
}
