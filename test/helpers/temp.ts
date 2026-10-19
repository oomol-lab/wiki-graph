import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

export async function withTempDir<T>(
  prefix: string,
  operation: (path: string) => Promise<T>,
): Promise<T> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  let failed = false;
  let operationError: unknown;
  let result: T | undefined;
  try {
    result = await operation(path);
  } catch (error) {
    failed = true;
    operationError = error;
  }
  try {
    await rm(path, { force: true, recursive: true });
  } catch (cleanupError) {
    if (failed)
      throw new AggregateError(
        [operationError, cleanupError],
        "Temporary-directory operation and cleanup both failed",
      );
    throw cleanupError;
  }
  if (failed) throw operationError;
  return result as T;
}
