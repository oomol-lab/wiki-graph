import { installNodeWikiGraphPlatform } from "../packages/cli/src/runtime/node-platform.js";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterAll } from "vitest";

// Tests with a default SDK must never open the developer's real Home state.
const isolatedHome = await mkdtemp(join(tmpdir(), "wikigraph-test-home-"));
afterAll(async () => {
  await rm(isolatedHome, { recursive: true, force: true });
});

installNodeWikiGraphPlatform(isolatedHome);
