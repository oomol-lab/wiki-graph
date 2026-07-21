import { WikiGraphArchiveFile, type ReadonlyDocument } from "wiki-graph-core";

export async function readArchiveDocument<T>(
  path: string,
  operation: (document: ReadonlyDocument) => Promise<T> | T,
): Promise<void> {
  await new WikiGraphArchiveFile(path).readDocument(operation);
}
