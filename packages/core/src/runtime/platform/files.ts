import type { Directory, File, ReadonlyFile } from "./types.js";

export async function copyFileContent(
  source: ReadonlyFile,
  target: File,
): Promise<void> {
  const reader = await source.openReader();
  try {
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
    }
  } finally {
    await reader.close();
  }
}

export async function readHostFileSize(file: ReadonlyFile): Promise<number> {
  const reader = await file.openReader();
  try {
    return reader.size;
  } finally {
    await reader.close();
  }
}

export async function isHostFileEmpty(file: ReadonlyFile): Promise<boolean> {
  return (await readHostFileSize(file)) === 0;
}

export async function readFileText(file: ReadonlyFile): Promise<string> {
  return new TextDecoder().decode(await readFileBytes(file));
}

export async function readFileBytes(file: ReadonlyFile): Promise<Uint8Array> {
  const reader = await file.openReader();
  try {
    const output = new Uint8Array(reader.size);
    for (let offset = 0; offset < reader.size; ) {
      const chunk = await reader.read(
        offset,
        Math.min(64 * 1024, reader.size - offset),
      );
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return output;
  } finally {
    await reader.close();
  }
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
  const reader = await file.openReader().catch(() => undefined);
  let writer: Awaited<ReturnType<File["openWriter"]>> | undefined;
  try {
    writer = await file.openWriter();
    if (reader !== undefined) {
      for (let offset = 0; offset < reader.size; ) {
        const chunk = await reader.read(
          offset,
          Math.min(64 * 1024, reader.size - offset),
        );
        await writer.write(chunk);
        offset += chunk.byteLength;
      }
    }
    await writer.write(content);
    await writer.commit();
  } catch (error) {
    await writer?.abort().catch(() => undefined);
    throw error;
  } finally {
    await reader?.close();
  }
}

export async function readHostEntrySize(
  entry: ReadonlyFile | Directory,
): Promise<number> {
  if (isDirectory(entry)) {
    let size = 0;
    for (const child of await entry.list())
      size += await readHostEntrySize(child);
    return size;
  }
  return await readHostFileSize(entry);
}

export async function getHostEntryLastModified(
  entry: ReadonlyFile | Directory,
): Promise<number | undefined> {
  return await entry.getLastModified?.();
}

export function isDirectory(
  entry: ReadonlyFile | Directory,
): entry is Directory {
  return entry.kind === "directory";
}
