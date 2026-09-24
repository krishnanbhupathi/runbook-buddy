import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Plain vitest (no Workers runtime): fast, and enough for the pure logic plus
// the Workflow orchestration, which we exercise with a stubbed `cloudflare:workers`.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    alias: {
      "cloudflare:workers": fileURLToPath(new URL("./test/stubs/cloudflare-workers.ts", import.meta.url)),
    },
  },
});
