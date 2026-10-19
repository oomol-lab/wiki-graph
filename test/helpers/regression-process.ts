import { fork } from "child_process";
import { once } from "events";
import { fileURLToPath } from "url";

/** IPC barriers coordinate real processes without timing-dependent sleeps. */
export function startRegressionProcess(mode: string, root: string) {
  const child = fork(
    fileURLToPath(new URL("./windows-regression-worker.ts", import.meta.url)),
    [mode, root],
    {
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    },
  );
  let stderr = "";
  child.stdout!.resume();
  child.stderr!.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const messages: unknown[] = [];
  const waiting: Array<{
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }> = [];
  child.on("message", (message) => {
    const waiter = waiting.shift();
    if (waiter === undefined) messages.push(message);
    else waiter.resolve(message);
  });
  let exited = false;
  const exit = once(child, "close").then(
    ([code]) => {
      exited = true;
      for (const waiter of waiting.splice(0))
        waiter.reject(new Error(`Worker exited (${code}): ${stderr}`));
      return code as number | null;
    },
    (error: Error) => {
      exited = true;
      stderr += error.message;
      for (const waiter of waiting.splice(0)) waiter.reject(error);
      return -1;
    },
  );
  // A missing protocol response must fail with diagnostics and release the child.
  const deadline = setTimeout(() => child.kill("SIGKILL"), 60_000);
  void exit.finally(() => clearTimeout(deadline));
  return {
    child,
    exit,
    message: async (): Promise<unknown> => {
      if (messages.length > 0) return messages.shift();
      if (exited) throw new Error(`Worker already exited: ${stderr}`);
      return await new Promise((resolve, reject) =>
        waiting.push({ resolve, reject }),
      );
    },
    stop: async () => {
      if (!exited) child.kill("SIGKILL");
      await exit;
    },
  };
}
