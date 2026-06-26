import { chmod, mkdtemp, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

import { describe, expect, it } from "vitest";

import { matchWikispineSentenceCandidates } from "../../src/wikimatch/index.js";

describe("wikimatch/wikispine", () => {
  it("matches each sentence separately and converts sentence offsets to document ranges", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "wikispine-test-"));
    const commandPath = join(tempDir, "fake-wikispine.mjs");
    const logPath = join(tempDir, "stdin.log");

    await writeFile(
      commandPath,
      [
        "#!/usr/bin/env node",
        "import { appendFileSync, readFileSync } from 'node:fs';",
        "const input = readFileSync(0, 'utf8');",
        `appendFileSync(${JSON.stringify(logPath)}, JSON.stringify(input) + "\\n");`,
        "if (input.includes('恩典')) {",
        "  console.log(JSON.stringify({ type: 'match', match: { start: input.indexOf('恩典'), end: input.indexOf('恩典') + 2, surface_id: 1, qids: [{ qid: 'Q205194', qid_number: 205194, disambiguation: false }] } }));",
        "}",
        "if (input.includes('句末句首')) {",
        "  console.log(JSON.stringify({ type: 'match', match: { start: input.indexOf('句末句首'), end: input.indexOf('句末句首') + 4, surface_id: 2, qids: [{ qid: 'Q404', qid_number: 404, disambiguation: false }] } }));",
        "}",
        "console.log(JSON.stringify({ type: 'done', stats: { matches: 1 } }));",
      ].join("\n"),
    );
    await chmod(commandPath, 0o755);

    const candidates = await matchWikispineSentenceCandidates({
      command: commandPath,
      maxCandidatesPerSurface: 3,
      sentences: [
        {
          range: { end: 5, start: 0 },
          text: "前文句末",
        },
        {
          range: { end: 12, start: 5 },
          text: "句首有恩典",
        },
      ],
    });

    expect((await readFile(logPath, "utf8")).trim().split("\n")).toStrictEqual([
      JSON.stringify("前文句末"),
      JSON.stringify("句首有恩典"),
    ]);
    expect(candidates).toStrictEqual([
      {
        id: "c1",
        qidOptions: [
          {
            isDisambiguation: false,
            qid: "Q205194",
          },
        ],
        range: {
          end: 10,
          start: 8,
        },
        surface: "恩典",
      },
    ]);
  });
});
