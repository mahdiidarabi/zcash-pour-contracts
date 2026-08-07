import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    alias: {
      // circomlibjs imports Node's assert. Without this the bundler stubs it as
      // an empty object and Poseidon dies with "x is not a function".
      assert: fileURLToPath(new URL("./src/shims/assert.ts", import.meta.url)),
    },
  },
  // snarkjs and circomlibjs are CommonJS with node-shaped deps; pre-bundling
  // them lets esbuild resolve that once instead of at every reload.
  optimizeDeps: { include: ["snarkjs", "circomlibjs", "ethers"] },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 2000,
    // circomlibjs and snarkjs are CommonJS with ESM-looking entry points.
    // Without this, Rollup can resolve a named export to undefined in the
    // production build while the dev server is perfectly happy.
    commonjsOptions: { transformMixedEsModules: true },
  },
});
