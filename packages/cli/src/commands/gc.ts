import type { GcRunReport } from "wiki-graph-core/gc";

import type { CLIGcArguments } from "../args/index.js";
import { runInternalChildJSON } from "../runtime/internal-child.js";
import { writeTextToStdout } from "../support/index.js";
import { formatCLIJSON } from "../support/index.js";

export async function runGcCommand(args: CLIGcArguments): Promise<void> {
  const report = await runInternalChildJSON<GcRunReport>("gc-worker", {
    args: [
      ...(args.dryRun === true ? ["--dry-run"] : []),
      ...(args.force === true ? ["--force"] : []),
    ],
  });

  if (args.json === true) {
    await writeTextToStdout(formatCLIJSON(report));
    return;
  }

  if (report.skipped) {
    await writeTextToStdout("GC skipped: another GC run is active.\n");
    return;
  }

  await writeTextToStdout(
    [
      `GC completed.`,
      `Scanned: ${report.scanned}`,
      `Removed: ${report.removed}`,
      `Freed: ${formatBytes(report.freedBytes)}`,
      ...report.jobs.map((job) =>
        job.error === undefined
          ? `- ${job.name}: scanned ${job.scanned}, removed ${job.removed}, freed ${formatBytes(job.freedBytes)}`
          : `- ${job.name}: failed: ${job.error}`,
      ),
      "",
    ].join("\n"),
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}
