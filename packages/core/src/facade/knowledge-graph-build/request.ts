import type {
  GuaranteedRequest,
  GuaranteedRequestController,
} from "../../guaranteed/index.js";

export async function mapLazyGuaranteedRequests<TItem, TResult>(
  request: GuaranteedRequestController,
  items: readonly TItem[],
  operation: (item: TItem, request: GuaranteedRequest) => Promise<TResult>,
): Promise<readonly TResult[]> {
  const lazy = request.lazy;

  if (lazy !== undefined) {
    return await Promise.all(
      items.map(
        async (item) =>
          await lazy(async (request) => await operation(item, request)),
      ),
    );
  }

  const results: TResult[] = [];

  for (const item of items) {
    results.push(await operation(item, request));
  }

  return results;
}
