import type {
  GuaranteedRequest,
  GuaranteedRequestController,
} from "../../guaranteed/index.js";

const LAZY_REQUEST_WORKERS = 4;

export async function mapLazyGuaranteedRequests<TItem, TResult>(
  request: GuaranteedRequestController,
  items: readonly TItem[],
  operation: (item: TItem, request: GuaranteedRequest) => Promise<TResult>,
): Promise<readonly TResult[]> {
  const lazy = request.lazy;

  if (lazy !== undefined) {
    const results: TResult[] = [];
    let nextIndex = 0;
    const worker = async (): Promise<void> => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await lazy(
          async (request) => await operation(items[index]!, request),
        );
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(LAZY_REQUEST_WORKERS, items.length) },
        worker,
      ),
    );
    return results;
  }

  const results: TResult[] = [];

  for (const item of items) {
    results.push(await operation(item, request));
  }

  return results;
}
