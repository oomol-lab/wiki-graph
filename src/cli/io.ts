import { createReadStream } from "fs";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

export function readTextStreamFromStdin(): AsyncIterable<string> {
  process.stdin.setEncoding("utf8");
  return process.stdin;
}

export async function writeTextFileToStdout(path: string): Promise<void> {
  for await (const chunk of createReadStream(path, { encoding: "utf8" })) {
    await writeChunkToStdout(String(chunk));
  }
}

export async function writeTextToStdout(text: string): Promise<void> {
  await writeChunkToStdout(text);
}

export async function writeTextToStderr(text: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    process.stderr.write(text, (error) => {
      if (error === undefined || error === null) {
        resolve();
        return;
      }

      reject(error);
    });
  });
}

export async function writeBinaryToStdout(data: Uint8Array): Promise<void> {
  await writeChunkToStdout(data);
}

async function writeChunkToStdout(chunk: string | Uint8Array): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    process.stdout.write(chunk, (error) => {
      if (error === undefined || error === null) {
        resolve();
        return;
      }

      reject(error);
    });
  });
}

export async function createTemporaryOutputPath(
  prefix: string,
  extension: string,
): Promise<{
  readonly directoryPath: string;
  readonly filePath: string;
}> {
  const directoryPath = await mkdtemp(join(tmpdir(), prefix));

  return {
    directoryPath,
    filePath: join(directoryPath, `output${extension}`),
  };
}

export async function removeTemporaryDirectory(
  directoryPath: string,
): Promise<void> {
  await rm(directoryPath, { force: true, recursive: true });
}
