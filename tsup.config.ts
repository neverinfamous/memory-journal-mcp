import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    cli: "src/cli.ts",
    "worker-script": "src/codemode/worker-script.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  treeshake: true,
  splitting: false,
  sourcemap: false,
  minify: false,
  outDir: "dist",
  target: "es2022",
  external: ["better-sqlite3", "sqlite-vec", "@huggingface/transformers"],
});
