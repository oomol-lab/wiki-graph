import { mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { setTimeout } from "timers/promises";
import { it } from "vitest";
import {
  regressionLifecycle,
  regressionTest,
} from "../../helpers/regression-lifecycle.js";

it(
  "deliberately times out while setup still owns files",
  regressionTest(async () => {
    const root = process.env.WIKIGRAPH_LIFECYCLE_ROOT!;
    const workspace = join(root, "workspace");
    const order: string[] = [];
    regressionLifecycle().defer(async () => {
      await rm(workspace, { recursive: true });
      order.push("remove");
      await writeFile(join(root, "order.json"), JSON.stringify(order));
    });
    regressionLifecycle().defer(() => {
      order.push("close");
    });
    await mkdir(workspace);
    try {
      await setTimeout(150);
      await writeFile(join(workspace, "late.txt"), "still active");
      order.push("late-write");
    } finally {
      await writeFile(join(workspace, "finally.txt"), "released");
      order.push("finally");
    }
  }),
  25,
);
