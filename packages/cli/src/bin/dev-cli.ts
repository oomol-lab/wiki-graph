import { resolve } from "path";

declare global {
  var __WIKIGRAPH_STATE_DIR__: string | undefined;
}

globalThis.__WIKIGRAPH_STATE_DIR__ = resolve(
  import.meta.dirname,
  "../../../../.wikigraph/state",
);

const { main } = await import("../app/index.js");

void main();
