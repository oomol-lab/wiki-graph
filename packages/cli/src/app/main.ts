import { runWikiGraphCLI } from "./runner.js";

export async function main(): Promise<void> {
  const result = await runWikiGraphCLI();
  process.exitCode = result.exitCode;
}
