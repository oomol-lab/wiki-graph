import { spawnSync } from "child_process";

const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const result = spawnSync(command, ["-r", "--sort", "run", "build"], {
  env: {
    ...process.env,
    NODE_OPTIONS: [process.env.NODE_OPTIONS, "--max-old-space-size=8192"]
      .filter(Boolean)
      .join(" "),
  },
  shell: process.platform === "win32",
  stdio: "inherit",
});

if (result.error !== undefined) throw result.error;
process.exitCode = result.status ?? 1;
