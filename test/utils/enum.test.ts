import { describe, expect, it } from "vitest";

import {
  createEnumValueAsserter,
  createEnumValueGuard,
} from "../../src/utils/enum.js";

enum DemoEnum {
  Alpha = "alpha",
  Beta = "beta",
}

describe("utils/enum", () => {
  it("creates enum guards", () => {
    const isDemoEnum = createEnumValueGuard(DemoEnum);

    expect(isDemoEnum("alpha")).toBe(true);
    expect(isDemoEnum("gamma")).toBe(false);
  });

  it("creates enum asserters", () => {
    const expectDemoEnum = createEnumValueAsserter(DemoEnum, "demo enum");

    expect(expectDemoEnum("beta")).toBe("beta");
    expect(() => expectDemoEnum("gamma")).toThrow("Unknown demo enum: gamma");
  });
});
