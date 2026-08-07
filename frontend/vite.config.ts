import { defineConfig } from "vite";

export default defineConfig({
  // snarkjs and circomlibjs are CommonJS with node-shaped deps; pre-bundling
  // them lets esbuild resolve that once instead of at every reload.
  optimizeDeps: { include: ["snarkjs", "circomlibjs", "ethers"] },
  build: { target: "es2022", chunkSizeWarningLimit: 2000 },
});
