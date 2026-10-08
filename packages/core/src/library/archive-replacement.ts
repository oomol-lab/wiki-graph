export interface AtomicArchiveReplacement<T> {
  readonly finalize: () => Promise<T>;
  readonly publish: () => Promise<void>;
  readonly recover: () => Promise<void>;
  readonly rollback: () => Promise<void>;
}

/** Keep a failed post-publish finalization from leaving the replacement visible. */
export async function commitAtomicArchiveReplacement<T>(
  replacement: AtomicArchiveReplacement<T>,
): Promise<T> {
  await replacement.publish();
  try {
    return await replacement.finalize();
  } catch (error) {
    try {
      await replacement.rollback();
      await replacement.recover();
    } catch (recoveryError) {
      throw new AggregateError(
        [error, recoveryError],
        "Archive replacement failed and the previous archive could not be fully restored.",
      );
    }
    throw error;
  }
}
