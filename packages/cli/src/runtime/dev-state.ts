import { resolve } from "path";

export function resolveDevStateDirectoryPath(): string {
  return resolve(import.meta.dirname, "../../../../.wikigraph/state");
}

export function enableDevStateDirectory(): void {
  process.env.WIKIGRAPH_DEV = resolveDevStateDirectoryPath();
}
