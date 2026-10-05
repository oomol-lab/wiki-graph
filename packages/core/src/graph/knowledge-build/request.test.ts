import { describe, expect, it } from "vitest";

import type { GuaranteedRequestController } from "../../external/guaranteed/index.js";
import { mapLazyGuaranteedRequests } from "./request.js";

describe("mapLazyGuaranteedRequests", () => {
  it("bounds lazy work while preserving result order", async () => {
    const request: GuaranteedRequestController = () =>
      Promise.resolve(undefined);
    request.lazy = async (operation) => await operation(request);
    let active = 0;
    let maxActive = 0;
    const items = Array.from({ length: 12 }, (_, index) => index);

    const results = await mapLazyGuaranteedRequests(
      request,
      items,
      async (item) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise<void>((resolve) => setTimeout(resolve, 1));
        active -= 1;
        return item * 2;
      },
    );

    expect(maxActive).toBe(4);
    expect(results).toStrictEqual(items.map((item) => item * 2));
  });
});
