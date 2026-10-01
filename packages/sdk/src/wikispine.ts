import { spawn } from "child_process";

import type { WikispineCommandRunner } from "wiki-graph-core";

/** Node host implementation for Core's optional WikiSpine command capability. */
export const nodeWikispineCommandRunner: WikispineCommandRunner = {
  run: async ({ args, command, input, onStdout, signal }) =>
    await new Promise((resolve, reject) => {
      signal?.throwIfAborted();
      const child = spawn(command, [...args], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      const stderr: Uint8Array[] = [];
      let settled = false;
      const settle = (operation: () => void): void => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", abort);
        operation();
      };
      const abort = (): void => {
        child.kill();
        settle(() => reject(abortError(signal)));
      };
      signal?.addEventListener("abort", abort, { once: true });

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        if (settled) return;
        try {
          onStdout(chunk);
        } catch (error) {
          child.kill();
          settle(() =>
            reject(error instanceof Error ? error : new Error(String(error))),
          );
        }
      });
      child.stderr.on("data", (chunk: Uint8Array) => stderr.push(chunk));
      child.on("error", (error) => {
        settle(() =>
          reject(
            new Error(`Failed to start wikispine command: ${error.message}`),
          ),
        );
      });
      child.on("close", (exitCode) => {
        settle(() =>
          resolve({
            exitCode,
            stderr: Buffer.concat(stderr).toString("utf8"),
          }),
        );
      });
      child.stdin.end(input);
    }),
};

function abortError(signal: AbortSignal | undefined): Error {
  return signal?.reason instanceof Error
    ? signal.reason
    : new Error("WikiSpine command aborted.");
}
