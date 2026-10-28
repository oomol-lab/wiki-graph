import { mapConcurrent } from "wiki-graph-runtime";
import type {
  GuaranteedRequest,
  GuaranteedRequestController,
} from "../../external/guaranteed/index.js";

const LAZY_REQUEST_WORKERS = 4;

export async function mapLazyGuaranteedRequests<TItem, TResult>(
  request: GuaranteedRequestController,
  items: readonly TItem[],
  operation: (item: TItem, request: GuaranteedRequest) => Promise<TResult>,
): Promise<readonly TResult[]> {
  const results: TResult[] = [];
  for await (const result of mapConcurrent(
    items,
    async (item, signal) => {
      const run = async (delegate: GuaranteedRequest) =>
        await operation(item, (messages, index, maxRetries, context) => {
          signal.throwIfAborted();
          return delegate(messages, index, maxRetries, {
            ...context,
            signal: context?.signal
              ? AbortSignal.any([context.signal, signal])
              : signal,
          });
        });
      return request.lazy ? await request.lazy(run) : await run(request);
    },
    { concurrency: request.lazy ? LAZY_REQUEST_WORKERS : 1 },
  ))
    results.push(result);
  return results;
}
