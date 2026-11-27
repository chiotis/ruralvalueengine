import { defineConfig } from "vitest/config";

// Test files share one database, so run them one at a time.
export default defineConfig({
  test: {
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 20000,
  },
});
