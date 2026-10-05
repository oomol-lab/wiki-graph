import { chmod, mkdtemp, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_WIKISPINE_FETCH_ENDPOINT,
  matchWikispineSentenceCandidates,
} from "../../../../packages/core/src/external/wikimatch/index.js";
import { nodeWikispineCommandRunner } from "../../../../packages/cli/src/runtime/wikispine.js";

describe("wikimatch/wikispine", () => {
  it("yields the first fetch match before reading the rest of the response", async () => {
    const chunks = [
      `${matchEvent(0, 4, "Q1")}\n`,
      `${JSON.stringify({ type: "done" })}\n${matchEvent(0, 4, "Q2")}\n`,
    ];
    let reads = 0;
    let cancellations = 0;
    const body = {
      getReader: () => ({
        cancel: () => {
          cancellations += 1;
          return Promise.resolve();
        },
        read: () => {
          const chunk = chunks[reads];
          reads += 1;
          if (chunk === undefined) return new Promise<never>(() => undefined);
          return Promise.resolve({
            done: false as const,
            value: new TextEncoder().encode(chunk),
          });
        },
        releaseLock: () => undefined,
      }),
    };
    const iterator = matchWikispineSentenceCandidates({
      fetch: () =>
        Promise.resolve({
          body,
          ok: true,
          status: 200,
        } as Response),
      provider: "fetch",
      sentences: [{ range: { end: 4, start: 0 }, text: "test" }],
      token: "api-key",
    })[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { qidOptions: [{ qid: "Q1" }], surface: "test" },
    });
    expect(reads).toBe(1);
    await expect(iterator.next()).resolves.toMatchObject({ done: true });
    expect(reads).toBe(2);
    expect(cancellations).toBe(1);
  });

  it("stops the CLI provider at done without waiting for process exit", async () => {
    let providerSignal: AbortSignal | undefined;
    const candidates = await collect(
      matchWikispineSentenceCandidates({
        commandRunner: {
          run: async ({ onStdout, signal }) => {
            providerSignal = signal;
            await onStdout(
              `${matchEvent(0, 1, "Q1")}\n${JSON.stringify({ type: "done" })}\n${matchEvent(1, 2, "Q2")}\n`,
            );
            if (signal?.aborted === true) throw new Error("process stopped");
            await new Promise<void>((_resolve, reject) => {
              signal?.addEventListener(
                "abort",
                () => reject(new Error("process stopped")),
                { once: true },
              );
            });
            return { exitCode: 0, stderr: "" };
          },
        },
        sentences: [{ range: { end: 2, start: 0 }, text: "ab" }],
      }),
    );

    expect(
      candidates.map(({ qidOptions }) => qidOptions[0]?.qid),
    ).toStrictEqual(["Q1"]);
    expect(providerSignal?.aborted).toBe(true);
  });

  it("serializes progress callbacks and applies their backpressure", async () => {
    let releaseFirst!: () => void;
    const firstProgress = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let calls = 0;
    let active = 0;
    let maxActive = 0;
    const iterator = matchWikispineSentenceCandidates({
      fetch: () =>
        Promise.resolve(
          new Response(
            `${matchEvent(0, 1, "Q1")}\n${matchEvent(1, 2, "Q2")}\n${JSON.stringify({ type: "done" })}\n`,
          ),
        ),
      onProgress: async () => {
        calls += 1;
        active += 1;
        maxActive = Math.max(maxActive, active);
        if (calls === 1) await firstProgress;
        active -= 1;
      },
      provider: "fetch",
      sentences: [{ range: { end: 2, start: 0 }, text: "ab" }],
      token: "api-key",
    })[Symbol.asyncIterator]();
    const first = iterator.next();
    await vi.waitFor(() => expect(calls).toBe(1));
    expect(active).toBe(1);

    releaseFirst();
    await first;
    expect(calls).toBe(1);
    await iterator.next();
    expect(calls).toBe(2);
    expect(maxActive).toBe(1);
    await iterator.return?.();
  });

  it("rejects a fetch stream without a done event", async () => {
    await expect(
      collect(
        matchWikispineSentenceCandidates({
          fetch: () =>
            Promise.resolve(new Response(`${matchEvent(0, 1, "Q1")}\n`)),
          provider: "fetch",
          sentences: [{ range: { end: 1, start: 0 }, text: "a" }],
          token: "api-key",
        }),
      ),
    ).rejects.toThrow("ended before the done event");
  });

  it("rejects malformed CLI output without leaving the iterator pending", async () => {
    await expect(
      collect(
        matchWikispineSentenceCandidates({
          commandRunner: {
            run: async ({ onStdout }) => {
              await onStdout('{"type":');
              return { exitCode: 0, stderr: "" };
            },
          },
          sentences: [{ range: { end: 1, start: 0 }, text: "a" }],
        }),
      ),
    ).rejects.toThrow("Invalid WikiSpine match response");
  });

  it("aborts the CLI provider when the consumer stops early", async () => {
    let providerSignal: AbortSignal | undefined;
    const iterator = matchWikispineSentenceCandidates({
      commandRunner: {
        run: async ({ onStdout, signal }) => {
          providerSignal = signal;
          await onStdout(`${matchEvent(0, 1, "Q1")}\n`);
          await new Promise<void>((_resolve, reject) => {
            signal?.addEventListener(
              "abort",
              () =>
                reject(
                  signal.reason instanceof Error
                    ? signal.reason
                    : new Error("aborted"),
                ),
              { once: true },
            );
          });
          return { exitCode: 0, stderr: "" };
        },
      },
      sentences: [{ range: { end: 1, start: 0 }, text: "a" }],
    })[Symbol.asyncIterator]();

    await iterator.next();
    await iterator.return?.();

    expect(providerSignal?.aborted).toBe(true);
  });

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

    const progress: number[] = [];
    const candidates = await collect(
      matchWikispineSentenceCandidates({
        command: commandPath,
        commandRunner: nodeWikispineCommandRunner,
        maxCandidatesPerSurface: 3,
        onProgress: (event) => {
          progress.push(event.coveredRangeEnd);
        },
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
      }),
    );

    expect((await readFile(logPath, "utf8")).trim().split("\n")).toStrictEqual([
      JSON.stringify("前文句末"),
      JSON.stringify("句首有恩典"),
    ]);
    expect(progress).toStrictEqual([5, 10, 12]);
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
    const requests: Array<{
      readonly body: unknown;
      readonly signal: AbortSignal | null | undefined;
      readonly url: string;
    }> = [];
    const fetchMock: typeof fetch = (input, init) => {
      requests.push({
        body:
          typeof init?.body === "string" ? JSON.parse(init.body) : init?.body,
        signal: init?.signal,
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

    const progress: number[] = [];
    const signal = new AbortController().signal;

    await expect(
      collect(
        matchWikispineSentenceCandidates({
          endpoint: "https://wikispine.example/",
          fetch: fetchMock,
          includeDisambiguation: false,
          maxCandidatesPerSurface: 1,
          onProgress: (event) => {
            progress.push(event.coveredRangeEnd);
          },
          provider: "fetch",
          signal,
          sentences: [
            {
              range: { end: 9, start: 5 },
              text: "北京大学",
            },
          ],
          token: "api-key",
        }),
      ),
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
    expect(progress).toStrictEqual([9, 9]);
    expect(requests).toStrictEqual([
      {
        body: {
          options: {
            include_disambiguation: false,
            max_candidates_per_surface: 1,
          },
          text: "北京大学",
        },
        signal,
        url: "https://wikispine.example/match",
      },
    ]);
  });

  it("aborts an active CLI provider process", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "wikispine-test-"));
    const commandPath = join(tempDir, "slow-wikispine.mjs");
    await writeFile(
      commandPath,
      [
        "#!/usr/bin/env node",
        "process.stdin.resume();",
        "setInterval(() => {}, 1_000);",
      ].join("\n"),
    );
    await chmod(commandPath, 0o755);
    const controller = new AbortController();
    const matching = collect(
      matchWikispineSentenceCandidates({
        command: commandPath,
        commandRunner: nodeWikispineCommandRunner,
        signal: controller.signal,
        sentences: [{ range: { end: 4, start: 0 }, text: "北京大学" }],
      }),
    );
    controller.abort(new Error("job stopped"));
    await expect(matching).rejects.toThrow("job stopped");
  });

  it("rejects CLI matches when progress reporting fails", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "wikispine-test-"));
    const commandPath = join(tempDir, "fake-wikispine.mjs");

    await writeFile(
      commandPath,
      [
        "#!/usr/bin/env node",
        "console.log(JSON.stringify({ type: 'match', match: { start: 0, end: 4, surface_id: 1, qids: [{ qid: 'Q16952', disambiguation: false }] } }));",
        "console.log(JSON.stringify({ type: 'done', stats: { matches: 1 } }));",
      ].join("\n"),
    );
    await chmod(commandPath, 0o755);

    await expect(
      collect(
        matchWikispineSentenceCandidates({
          command: commandPath,
          commandRunner: nodeWikispineCommandRunner,
          onProgress: () => Promise.reject(new Error("progress stopped")),
          sentences: [
            {
              range: { end: 4, start: 0 },
              text: "北京大学",
            },
          ],
        }),
      ),
    ).rejects.toThrow("progress stopped");
  });

  it("rejects fetch matches when progress reporting fails", async () => {
    const fetchMock: typeof fetch = () =>
      Promise.resolve(
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

    await expect(
      collect(
        matchWikispineSentenceCandidates({
          endpoint: "https://wikispine.example/",
          fetch: fetchMock,
          onProgress: () => Promise.reject(new Error("progress stopped")),
          provider: "fetch",
          sentences: [
            {
              range: { end: 4, start: 0 },
              text: "北京大学",
            },
          ],
          token: "api-key",
        }),
      ),
    ).rejects.toThrow("progress stopped");
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

    await collect(
      matchWikispineSentenceCandidates({
        fetch: fetchMock,
        provider: "fetch",
        sentences: [
          {
            range: { end: 4, start: 0 },
            text: "北京大学",
          },
        ],
        token: "api-key",
      }),
    );

    expect(requests).toStrictEqual([
      {
        url: `${DEFAULT_WIKISPINE_FETCH_ENDPOINT}/match`,
      },
    ]);
  });

  it("includes the runtime guide URL in fetch provider failures", async () => {
    await expect(
      collect(
        matchWikispineSentenceCandidates({
          fetch: () => Promise.resolve(new Response("down", { status: 503 })),
          provider: "fetch",
          sentences: [
            {
              range: { end: 4, start: 0 },
              text: "北京大学",
            },
          ],
          token: "api-key",
        }),
      ),
    ).rejects.toThrow(
      "https://raw.githubusercontent.com/oomol-lab/wiki-graph/refs/heads/main/docs/wikispine-runtime.md",
    );
  });
});

async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const item of items) result.push(item);
  return result;
}

function matchEvent(start: number, end: number, qid: string): string {
  return JSON.stringify({
    match: {
      end,
      qids: [{ disambiguation: false, qid }],
      start,
      surface_id: 1,
    },
    type: "match",
  });
}
