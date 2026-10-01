import { getEventListeners } from "events";
import { setTimeout as delay } from "timers/promises";
import { describe, expect, it, vi } from "vitest";

import type { BuildJob, BuildJobEvent } from "wiki-graph-core";

import {
  WikiGraphJobManager,
  type WikiGraphJobBackend,
  type WikiGraphJobRuntime,
} from "./jobs.js";
import { NodeDirectory, NodeFile } from "./node-platform.js";

const runtime: WikiGraphJobRuntime = {
  run: async <T>(operation: () => Promise<T> | T): Promise<T> =>
    await operation(),
};

describe("WikiGraphJob events", () => {
  it("removes each abort listener after a polling timeout", async () => {
    let reads = 0;
    let observedEnoughReads: (() => void) | undefined;
    const enoughReads = new Promise<void>((resolve) => {
      observedEnoughReads = resolve;
    });
    const job = createJob("queued");
    const backend = createBackend(job, {
      readEvents: () => {
        reads += 1;
        if (reads === 20) observedEnoughReads?.();
        return Promise.resolve([]);
      },
    });
    const handle = await new WikiGraphJobManager(runtime, backend).get(
      job.jobId,
    );
    const controller = new AbortController();
    const next = handle
      .events({ pollIntervalMs: 1, signal: controller.signal })
      [Symbol.asyncIterator]()
      .next();

    await enoughReads;
    expect(
      getEventListeners(controller.signal, "abort").length,
    ).toBeLessThanOrEqual(1);

    controller.abort();
    await expect(next).resolves.toEqual({ done: true, value: undefined });
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });

  it("waits for the terminal event when the terminal snapshot arrives first", async () => {
    const running = createJob("running");
    const succeeded = createJob("succeeded");
    const terminalEvent: BuildJobEvent = {
      at: 3,
      jobId: running.jobId,
      seq: 1,
      state: "succeeded",
      type: "succeeded",
    };
    let statusReads = 0;
    let eventReads = 0;
    const backend = createBackend(running, {
      get: () => Promise.resolve(statusReads++ === 0 ? running : succeeded),
      readEvents: () => {
        eventReads += 1;
        return Promise.resolve(eventReads < 3 ? [] : [terminalEvent]);
      },
    });
    const handle = await new WikiGraphJobManager(runtime, backend).get(
      running.jobId,
    );

    const events: BuildJobEvent[] = [];
    for await (const event of handle.events({ pollIntervalMs: 0 })) {
      events.push(event);
    }

    expect(events).toEqual([terminalEvent]);
    expect(eventReads).toBe(3);
  });

  it("stops a callback subscription without canceling the persisted job", async () => {
    let reads = 0;
    let observedEnoughReads: (() => void) | undefined;
    const enoughReads = new Promise<void>((resolve) => {
      observedEnoughReads = resolve;
    });
    const job = createJob("queued");
    const cancel = vi.fn(() => Promise.resolve(job));
    const backend = createBackend(job, {
      cancel,
      readEvents: () => {
        reads += 1;
        if (reads === 5) observedEnoughReads?.();
        return Promise.resolve([]);
      },
    });
    const manager = new WikiGraphJobManager(runtime, backend);
    const handle = await manager.get(job.jobId);
    const listener = vi.fn();
    const unsubscribe = handle.subscribe(listener, { pollIntervalMs: 1 });

    await enoughReads;
    unsubscribe();
    await delay(10);
    const readsAfterUnsubscribe = reads;
    await delay(10);

    expect(reads).toBe(readsAfterUnsubscribe);
    expect(listener).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    manager.close();
  });
});

function createJob(state: BuildJob["state"]): BuildJob {
  return {
    archive: new NodeFile("/tmp/archive.wikg"),
    archiveKey: "archive",
    cache: new NodeDirectory("/tmp/cache"),
    chapterId: 1,
    createdAt: 1,
    events: new NodeFile("/tmp/events.jsonl"),
    jobId: "job-1",
    log: new NodeDirectory("/tmp/log"),
    queueRank: 1,
    state,
    target: "reading-summary",
    updatedAt: 2,
    workspace: new NodeDirectory("/tmp/workspace"),
  };
}

function createBackend(
  job: BuildJob,
  overrides: Partial<WikiGraphJobBackend> = {},
): WikiGraphJobBackend {
  return {
    add: vi.fn(() => Promise.resolve(job)),
    boost: vi.fn(() => Promise.resolve(job)),
    cancel: vi.fn(() => Promise.resolve(job)),
    get: vi.fn(() => Promise.resolve(job)),
    list: vi.fn(() => Promise.resolve([job])),
    pause: vi.fn(() => Promise.resolve(job)),
    readEvents: vi.fn(() => Promise.resolve([])),
    resume: vi.fn(() => Promise.resolve(job)),
    setTarget: vi.fn(() => Promise.resolve(job)),
    ...overrides,
  };
}
