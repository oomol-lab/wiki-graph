import { createHash } from "crypto";
import { resolve } from "path";

export function createArchiveKey(archivePath: string): string {
  return createHash("sha256").update(resolve(archivePath)).digest("hex");
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function formatErrorEvent(error: unknown): unknown {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack,
    };
  }

  return error;
}

export async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
}
