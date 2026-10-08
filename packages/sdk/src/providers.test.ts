import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createConfiguredEmbeddingProvider } from "./query-runtime.js";
import { createWikiGraphSDK } from "./sdk.js";
import { loadRequiredStageConfig } from "./stage.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(async (path) => await rm(path, { force: true, recursive: true })),
  );
});

describe("WikiGraphSDK providers", () => {
  it("isolates injected embedding providers by SDK instance", async () => {
    const root = await createRoot();
    const firstProvider = createEmbeddingProvider("first");
    const secondProvider = createEmbeddingProvider("second");
    const first = createWikiGraphSDK({
      providers: { embedding: firstProvider },
      stateDir: join(root, "first"),
    });
    const second = createWikiGraphSDK({
      providers: { embedding: secondProvider },
      stateDir: join(root, "second"),
    });

    const [resolvedFirst, resolvedSecond] = await Promise.all([
      first.run(createConfiguredEmbeddingProvider),
      second.run(createConfiguredEmbeddingProvider),
    ]);

    expect(resolvedFirst).toBe(firstProvider);
    expect(resolvedSecond).toBe(secondProvider);
    first.close();
    second.close();
  });

  it("uses an injected embedding provider in the instance worker", async () => {
    const root = await createRoot();
    const embedTexts = vi.fn(async (texts: readonly string[]) => {
      await Promise.resolve();
      return { embeddings: texts.map(() => [0.25, 0.75]) };
    });
    const sdk = createWikiGraphSDK({
      cwd: root,
      providers: {
        embedding: {
          dimensions: 2,
          embedTexts,
          identity: "injected:test",
          model: "injected-model",
        },
      },
      stateDir: join(root, "state"),
    });
    await sdk.archives.create({ path: "book.wikg" });
    const archive = await sdk.archives.open({
      kind: "standalone",
      path: "book.wikg",
    });
    const chapter = await archive.addChapter({
      source: "Injected embeddings are used by this job.",
      title: "Provider",
    });
    const result = await sdk.jobs.enqueue({
      archive: archive.target,
      chapterId: chapter.chapterId,
      target: "index-embedding-source",
    });
    const job = result.created[0]!.job;

    await sdk.jobs.runWorker({ idleTimeoutMs: 0 });

    expect((await job.status()).state).toBe("succeeded");
    expect(embedTexts).toHaveBeenCalled();
    await expect(
      archive.getChapterArtifact(chapter.path, "embedding-source"),
    ).resolves.toMatchObject({ current: true, missing: false });
    sdk.close();
  });

  it("accepts typed one-shot LLM config and rejects ambiguous overrides", async () => {
    const root = await createRoot();
    const sdk = createWikiGraphSDK({
      providers: {
        llm: {
          model: "injected",
          async *stream() {
            await Promise.resolve();
            yield { text: "unused", type: "text-delta" };
          },
        },
      },
      stateDir: join(root, "state"),
    });
    await sdk.archives.create({ path: join(root, "book.wikg") });
    const archive = await sdk.archives.open({
      kind: "standalone",
      path: join(root, "book.wikg"),
    });
    const chapter = await archive.addChapter({ source: "Source" });

    await expect(
      sdk.jobs.planEnqueue({
        archive: archive.target,
        chapterId: chapter.chapterId,
        target: "reading-summary",
      }),
    ).resolves.toMatchObject({ ready: [expect.any(Object)] });
    await expect(
      sdk.run(
        async () =>
          await loadRequiredStageConfig({
            llmJSON: JSON.stringify({
              model: "one-shot",
              provider: "openai",
            }),
          }),
      ),
    ).resolves.toMatchObject({
      llm: { model: "one-shot", provider: "openai" },
    });
    const queued = await sdk.jobs.enqueue({
      archive: archive.target,
      chapterId: chapter.chapterId,
      llm: { model: "one-shot", provider: "openai" },
      target: "reading-summary",
    });
    expect(JSON.parse(queued.created[0]!.job.snapshot.llmJSON!)).toEqual({
      model: "one-shot",
      provider: "openai",
    });
    await expect(
      sdk.jobs.planEnqueue({
        archive: archive.target,
        chapterId: chapter.chapterId,
        llm: { model: "one-shot", provider: "openai" },
        llmJSON: '{"model":"legacy"}',
        target: "reading-summary",
      }),
    ).rejects.toThrow("Pass either llm or llmJSON, not both.");
    sdk.close();
  });
});

function createEmbeddingProvider(model: string) {
  return {
    embedTexts: async (texts: readonly string[]) => {
      await Promise.resolve();
      return { embeddings: texts.map(() => [1, 0]) };
    },
    model,
  };
}

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "wiki-graph-providers-"));
  temporaryDirectories.push(root);
  return root;
}
