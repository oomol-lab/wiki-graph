import { expect, it } from "vitest";
import { CapacityPool } from "./capacity.js";
import { CandidateAcceptance } from "./candidate.js";
import { UsageLedger } from "./usage.js";
import { ProgressTracker } from "./progress.js";
import { QualityGate } from "./quality.js";
import { mapConcurrent } from "./executor.js";

it("retains capacity until resources settle and removes cancelled waiters", async () => {
  const pool = new CapacityPool(1, 2);
  let close!: () => void;
  const resource = new Promise<void>((resolve) => {
    close = resolve;
  });
  await pool.use((lease) => {
    lease.retainUntil(resource);
    return Promise.resolve();
  });
  expect(pool.active).toBe(1);
  const abort = new AbortController();
  const waiting = pool.use(() => {
    throw new Error("must not run");
  }, abort.signal);
  const error = new Error("cancelled");
  abort.abort(error);
  await expect(waiting).rejects.toBe(error);
  expect(pool.queued).toBe(0);
  close();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(pool.active).toBe(0);
});

it("keeps the first task failure when sibling cleanup throws", async () => {
  const first = new Error("first");
  let closed = false;
  function* source() {
    try {
      yield 1;
      yield 2;
    } finally {
      closed = true;
      // eslint-disable-next-line no-unsafe-finally
      throw new Error("cleanup");
    }
  }
  const iterate = async () => {
    for await (const _ of mapConcurrent(source(), () => Promise.reject(first), {
      concurrency: 2,
    })) {
      /* drain */
    }
  };
  await expect(iterate()).rejects.toBe(first);
  expect(closed).toBe(true);
});

it("rejects publication of an unaccepted candidate and reports persistence failure", async () => {
  let commits = 0;
  const candidate = new CandidateAcceptance();
  candidate.defer(() => {
    commits++;
  });
  await candidate.reject();
  expect(commits).toBe(0);
  const second = new CandidateAcceptance();
  const failure = new Error("state failed");
  second.defer(
    () => {},
    () => {
      throw failure;
    },
  );
  await expect(second.reject()).rejects.toBe(failure);
});

it("folds completed attempts without retaining history and deduplicates snapshots", () => {
  const ledger = new UsageLedger(1);
  for (let index = 0; index < 1000; index++) {
    const attempt = ledger.begin();
    attempt.record({ inputTokens: 4, outputTokens: 2 });
    attempt.record({ inputTokens: 4, outputTokens: 2 });
    attempt.finish("rejected");
    attempt.finish("accepted");
    attempt.record({ inputTokens: 999 });
  }
  const unknown = ledger.begin();
  unknown.record({ inputTokens: 3 });
  unknown.finish("unclassified");
  expect(ledger.snapshot().totals).toMatchObject({
    attempts: 1001,
    rejectedAttempts: 1000,
    acceptedAttempts: 0,
    unknownUsageAttempts: 1,
    inputTokens: 4003,
    outputTokens: 2000,
    pendingAttempts: 0,
  });
});

it("deduplicates monotonic phase progress while keeping attempt and unit boundaries", () => {
  const tracker = new ProgressTracker();
  const event = {
    scope: "chapter",
    phase: "extract",
    unit: "sentence",
    attempt: 0,
    done: 2,
    total: 3,
    outcome: "candidate" as const,
  };
  expect(tracker.update(event)?.done).toBe(2);
  expect(tracker.update(event)).toBeUndefined();
  expect(tracker.update({ ...event, done: 1 })).toBeUndefined();
  expect(tracker.update({ ...event, attempt: 1, done: 0 })?.done).toBe(0);
  expect(tracker.update({ ...event, unit: "window", done: 0 })?.total).toBe(3);
});

it("distinguishes validated empty output from all-failed fallback", () => {
  const quality = new QualityGate();
  quality.record("reading", "fallback", new Error("invalid"));
  expect(() => quality.assertUsable()).toThrow("All reading");
  quality.record("reading", "accepted");
  expect(() => quality.assertUsable()).not.toThrow();
  const strict = new QualityGate({ allowFallback: false });
  const failure = new Error("invalid");
  expect(() => strict.record("reading", "fallback", failure)).toThrow(failure);
});

it("does not pull beyond the window during slow consumption and closes early input", async () => {
  let pulled = 0;
  let closed = false;
  function* input() {
    try {
      for (let i = 0; i < 1000; i++) {
        pulled++;
        yield i;
      }
    } finally {
      closed = true;
    }
  }
  const iterator = mapConcurrent(input(), (value) => Promise.resolve(value), {
    concurrency: 3,
  })[Symbol.asyncIterator]();
  expect(await iterator.next()).toEqual({ done: false, value: 0 });
  await new Promise((resolve) => setTimeout(resolve, 5));
  expect(pulled).toBe(3);
  await iterator.return?.();
  expect(closed).toBe(true);
  expect(pulled).toBe(3);
});

it("quarantines an uncooperative operation across repeated cancellation", async () => {
  const { ProviderRuntime } = await import("./request.js");
  const runtime = new ProviderRuntime({ concurrency: 1 });
  let started!: () => void;
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const abort = new AbortController();
  const running = runtime.run(
    () => {
      started();
      return pending;
    },
    { signal: abort.signal },
  );
  await ready;
  abort.abort();
  await expect(running).rejects.toMatchObject({ name: "AbortError" });
  let replacements = 0;
  for (let i = 0; i < 3; i++) {
    const controller = new AbortController();
    const next = runtime.run(
      () => {
        replacements++;
        return Promise.resolve();
      },
      { signal: controller.signal },
    );
    controller.abort();
    await expect(next).rejects.toMatchObject({ name: "AbortError" });
  }
  expect(replacements).toBe(0);
  release();
  await runtime.run(() => {
    replacements++;
    return Promise.resolve();
  });
  expect(replacements).toBe(1);
});
