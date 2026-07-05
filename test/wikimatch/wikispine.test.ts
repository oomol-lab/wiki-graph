import { chmod, mkdtemp, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_WIKISPINE_FETCH_ENDPOINT,
  matchWikispineSentenceCandidates,
} from "../../src/wikimatch/index.js";

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

  it("matches through the fetch provider", async () => {
    const requests: Array<{ readonly body: unknown; readonly url: string }> =
      [];
    const fetchMock: typeof fetch = (input, init) => {
      requests.push({
        body:
          typeof init?.body === "string" ? JSON.parse(init.body) : init?.body,
        url:
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url,
      });

      return Promise.resolve(
        new Response(
          [
            JSON.stringify({
              match: {
                end: 4,
                qids: [{ disambiguation: false, qid: "Q16952" }],
                start: 0,
                surface_id: 1,
              },
              type: "match",
            }),
            JSON.stringify({ stats: { matches: 1 }, type: "done" }),
          ].join("\n"),
          {
            headers: {
              "content-type": "application/x-ndjson",
            },
            status: 200,
          },
        ),
      );
    };

    await expect(
      matchWikispineSentenceCandidates({
        endpoint: "https://wikispine.example/",
        fetch: fetchMock,
        includeDisambiguation: false,
        maxCandidatesPerSurface: 1,
        provider: "fetch",
        sentences: [
          {
            range: { end: 9, start: 5 },
            text: "北京大学",
          },
        ],
      }),
    ).resolves.toStrictEqual([
      {
        id: "c1",
        qidOptions: [
          {
            isDisambiguation: false,
            qid: "Q16952",
          },
        ],
        range: {
          end: 9,
          start: 5,
        },
        surface: "北京大学",
      },
    ]);
    expect(requests).toStrictEqual([
      {
        body: {
          options: {
            include_disambiguation: false,
            max_candidates_per_surface: 1,
          },
          text: "北京大学",
        },
        url: "https://wikispine.example/match",
      },
    ]);
  });

  it("keeps WikiSpine character offsets for Chinese text", async () => {
    const fetchMock: typeof fetch = () =>
      Promise.resolve(
        new Response(
          [
            JSON.stringify({
              match: {
                end: 7,
                qids: [{ disambiguation: false, qid: "Q704619" }],
                start: 4,
                surface_id: 1,
              },
              type: "match",
            }),
            JSON.stringify({ stats: { matches: 1 }, type: "done" }),
          ].join("\n"),
          {
            headers: {
              "content-type": "application/x-ndjson",
            },
            status: 200,
          },
        ),
      );

    await expect(
      matchWikispineSentenceCandidates({
        endpoint: "https://wikispine.example/",
        fetch: fetchMock,
        provider: "fetch",
        sentences: [
          {
            range: { end: 27, start: 20 },
            text: "矛头指向张士诚",
          },
        ],
      }),
    ).resolves.toStrictEqual([
      {
        id: "c1",
        qidOptions: [
          {
            isDisambiguation: false,
            qid: "Q704619",
          },
        ],
        range: {
          end: 27,
          start: 24,
        },
        surface: "张士诚",
      },
    ]);
  });

  it("falls back to UTF-8 byte offsets when a runtime returns out-of-range character offsets", async () => {
    const fetchMock: typeof fetch = () =>
      Promise.resolve(
        new Response(
          [
            JSON.stringify({
              match: {
                end: Buffer.byteLength("矛头指向张士诚", "utf8"),
                qids: [{ disambiguation: false, qid: "Q704619" }],
                start: Buffer.byteLength("矛头指向", "utf8"),
                surface_id: 1,
              },
              type: "match",
            }),
            JSON.stringify({ stats: { matches: 1 }, type: "done" }),
          ].join("\n"),
          {
            headers: {
              "content-type": "application/x-ndjson",
            },
            status: 200,
          },
        ),
      );

    await expect(
      matchWikispineSentenceCandidates({
        endpoint: "https://wikispine.example/",
        fetch: fetchMock,
        provider: "fetch",
        sentences: [
          {
            range: { end: 27, start: 20 },
            text: "矛头指向张士诚",
          },
        ],
      }),
    ).resolves.toStrictEqual([
      {
        id: "c1",
        qidOptions: [
          {
            isDisambiguation: false,
            qid: "Q704619",
          },
        ],
        range: {
          end: 27,
          start: 24,
        },
        surface: "张士诚",
      },
    ]);
  });

  it("uses the default fetch endpoint when none is configured", async () => {
    const requests: Array<{ readonly url: string }> = [];
    const fetchMock: typeof fetch = (input) => {
      requests.push({
        url:
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url,
      });

      return Promise.resolve(
        new Response(
          [
            JSON.stringify({
              match: {
                end: 4,
                qids: [{ disambiguation: false, qid: "Q16952" }],
                start: 0,
                surface_id: 1,
              },
              type: "match",
            }),
            JSON.stringify({ stats: { matches: 1 }, type: "done" }),
          ].join("\n"),
          {
            headers: {
              "content-type": "application/x-ndjson",
            },
            status: 200,
          },
        ),
      );
    };

    await matchWikispineSentenceCandidates({
      fetch: fetchMock,
      provider: "fetch",
      sentences: [
        {
          range: { end: 4, start: 0 },
          text: "北京大学",
        },
      ],
    });

    expect(requests).toStrictEqual([
      {
        url: `${DEFAULT_WIKISPINE_FETCH_ENDPOINT}/match`,
      },
    ]);
  });

  it("includes the runtime guide URL in fetch provider failures", async () => {
    await expect(
      matchWikispineSentenceCandidates({
        fetch: () => Promise.resolve(new Response("down", { status: 503 })),
        provider: "fetch",
        sentences: [
          {
            range: { end: 4, start: 0 },
            text: "北京大学",
          },
        ],
      }),
    ).rejects.toThrow(
      "https://raw.githubusercontent.com/oomol-lab/wiki-graph/refs/heads/main/docs/wikispine-runtime.md",
    );
  });
});
