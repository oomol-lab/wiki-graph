import type { Directory, File } from "./types.js";

export async function copyFileContent(
  source: File,
  target: File,
): Promise<void> {
  const reader = await source.openReader();
  const writer = await target.openWriter();
  try {
    for (let offset = 0; offset < reader.size; ) {
      const chunk = await reader.read(
        offset,
        Math.min(64 * 1024, reader.size - offset),
      );
      await writer.write(chunk);
      offset += chunk.byteLength;
    }
    await writer.commit();
  } catch (error) {
    await writer.abort().catch(() => undefined);
    throw error;
  } finally {
    await reader.close();
  }
}

export async function readFileText(file: File): Promise<string> {
  const content = await file.read({ encoding: "utf8" });
  return typeof content === "string"
    ? content
    : new TextDecoder().decode(content);
}

export async function writeFileContent(
  file: File,
  content: Uint8Array | string,
): Promise<void> {
  const writer = await file.openWriter();
  try {
    await writer.write(content);
    await writer.commit();
  } catch (error) {
    await writer.abort().catch(() => undefined);
    throw error;
  }
}

export async function appendFileText(
  file: File,
  content: string,
): Promise<void> {
  let current = "";
  try {
    current = await readFileText(file);
  } catch {
    // A newly created host File can legitimately have no backing bytes yet.
  }
  await writeFileContent(file, `${current}${content}`);
}

export async function readHostEntrySize(
  entry: File | Directory,
): Promise<number> {
  if (isDirectory(entry)) {
    let size = 0;
    for (const child of await entry.list())
      size += await readHostEntrySize(child);
    return size;
  }
  return entry.getSize === undefined
    ? (entry.size ?? 0)
    : await entry.getSize();
}

export async function getHostEntryLastModified(
  entry: File | Directory,
): Promise<number | undefined> {
  return entry.getLastModified === undefined
    ? entry.lastModified
    : await entry.getLastModified();
}

export function isDirectory(entry: File | Directory): entry is Directory {
  return "list" in entry;
}
