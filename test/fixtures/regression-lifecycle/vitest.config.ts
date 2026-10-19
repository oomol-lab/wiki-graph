import { defineConfig } from "vitest/config";

// A deliberately failing child runner, invoked only by its parent assertion.
export default defineConfig({
  test: {
    include: ["test/fixtures/regression-lifecycle/timeout.fixture.ts"],
    maxWorkers: 1,
  },
});
