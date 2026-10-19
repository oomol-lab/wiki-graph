import {
  getWikiGraphPlatform,
  type HostZipReader,
  type ReadonlyFile,
} from "../../../runtime/platform/index.js";
import { createPortableHash } from "../../../utils/crypto.js";
import { OWNER_HEARTBEAT_INTERVAL_MS } from "./constants.js";
import {
  createCoordinatorOwner,
  heartbeatArchiveOwner,
  registerArchiveOwner,
  unregisterArchiveOwner,
} from "./owners.js";

/** A bounded physical probe: no token read, overlay settlement or migration. */
export async function withArchiveZipProbe<T>(
  archive: ReadonlyFile,
  operation: (reader: HostZipReader) => Promise<T>,
): Promise<T> {
  const archiveKey = createPortableHash("sha256")
    .update(archive.identity)
    .digest("hex");
  const owner = createCoordinatorOwner();
  await registerArchiveOwner(archiveKey, owner);
  const heartbeat = globalThis.setInterval(() => {
    void heartbeatArchiveOwner(archiveKey, owner).catch(() => undefined);
  }, OWNER_HEARTBEAT_INTERVAL_MS);
  let reader: HostZipReader | undefined;
  let closed = false;
  const failures: unknown[] = [];
  let result: T | undefined;
  try {
    reader = await getWikiGraphPlatform().zip.open(archive, {
      entryNameMode: "normalized",
    });
    result = await operation(reader);
  } catch (error) {
    failures.push(error);
  } finally {
    try {
      await reader?.close();
      closed = true;
    } catch (error) {
      failures.push(error);
    }
    try {
      if (closed) await unregisterArchiveOwner(archiveKey, owner.ownerId);
    } catch (error) {
      failures.push(error);
    }
    globalThis.clearInterval(heartbeat);
  }
  if (failures.length > 0) throw failures[0];
  return result as T;
}
