import { homedir } from "os";
import { join } from "path";

export function resolveWikiGraphHomeDirectoryPath(): string {
  return join(homedir(), ".wikigraph");
}

export function resolveWikiGraphConfigFilePath(): string {
  return join(resolveWikiGraphHomeDirectoryPath(), "config.json");
}

export function resolveWikiGraphStateDirectoryPath(): string {
  return join(resolveWikiGraphHomeDirectoryPath(), "state");
}

export function resolveWikiGraphCoreDatabasePath(): string {
  return join(resolveWikiGraphHomeDirectoryPath(), "core.sqlite");
}

export function resolveWikiGraphCacheDatabasePath(): string {
  return join(resolveWikiGraphHomeDirectoryPath(), "cache.sqlite");
}
