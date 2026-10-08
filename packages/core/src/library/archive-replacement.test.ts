import { describe, expect, it, vi } from "vitest";

import { commitAtomicArchiveReplacement } from "./archive-replacement.js";

describe("commitAtomicArchiveReplacement", () => {
  it("does not roll back a replacement that finalizes successfully", async () => {
    const publish = vi.fn(async () => undefined);
    const rollback = vi.fn(async () => undefined);
    const recover = vi.fn(async () => undefined);

    await expect(
      commitAtomicArchiveReplacement({
        finalize: async () => "done",
        publish,
        recover,
        rollback,
      }),
    ).resolves.toBe("done");
    expect(publish).toHaveBeenCalledOnce();
    expect(rollback).not.toHaveBeenCalled();
    expect(recover).not.toHaveBeenCalled();
  });

  it("restores the old archive when post-publish finalization fails", async () => {
    const order: string[] = [];
    const failure = new Error("membership write failed");

    await expect(
      commitAtomicArchiveReplacement({
        finalize: async () => {
          order.push("finalize");
          throw failure;
        },
        publish: async () => {
          order.push("publish");
        },
        recover: async () => {
          order.push("recover");
        },
        rollback: async () => {
          order.push("rollback");
        },
      }),
    ).rejects.toBe(failure);
    expect(order).toEqual(["publish", "finalize", "rollback", "recover"]);
  });

  it("reports both failures when rollback cannot restore consistency", async () => {
    const failure = new Error("membership write failed");
    const recoveryFailure = new Error("rollback failed");

    await expect(
      commitAtomicArchiveReplacement({
        finalize: async () => {
          throw failure;
        },
        publish: async () => undefined,
        recover: async () => undefined,
        rollback: async () => {
          throw recoveryFailure;
        },
      }),
    ).rejects.toMatchObject({ errors: [failure, recoveryFailure] });
  });
});
