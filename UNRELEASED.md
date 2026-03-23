## [Unreleased]

### Changed

- Add `files` field to `package.json` — npm tarball now ships only `dist/`, `LICENSE`, and `README.md` (93% size reduction from 3.9 MB to ~250 KB)
- Override `onnxruntime-web` with empty stub — eliminates 90 MB unused browser WASM runtime from dependency tree
- Override `sharp` with empty stub — removes unused image processing transitive dependency from `@huggingface/transformers`
