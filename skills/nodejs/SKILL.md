---
name: nodejs
description: |
  Node.js core runtime standards. Use when working with native Node.js APIs like streams, buffers, child_process, worker_threads, filesystem, or event loop tuning. Do NOT trigger for generic 'build a server' requests unless the platform/language is explicitly specified.
---

# Node.js Core Standards

This skill provides best practices for utilizing native Node.js APIs safely and efficiently.

## 1. Streams and Memory Management

- **Streaming Data**: Always use streams (`fs.createReadStream`, `pipeline`) when handling files or network payloads larger than a few megabytes. Never buffer entire large files into memory using `fs.readFile`.
- **Pipeline Utility**: Always use `stream/promises.pipeline` to chain streams together. It properly handles error propagation and stream destruction to prevent memory leaks.

```typescript
import { pipeline } from 'node:stream/promises';
import { createReadStream, createWriteStream } from 'node:fs';

await pipeline(
  createReadStream('large-file.csv'),
  processTransformStream,
  createWriteStream('output.csv')
);
```

## 2. Event Loop Blocking

- **Synchronous APIs**: Never use synchronous native APIs (`fs.readFileSync`, `crypto.pbkdf2Sync`) in a web server context, as they block the main event loop and freeze all other requests. Only use them during application startup or in CLI scripts.
- **CPU Intensive Tasks**: Offload CPU-intensive work (image processing, heavy cryptography, massive JSON parsing) to `worker_threads` or external processes.

## 3. Child Processes

- **exec vs spawn**: Avoid `child_process.exec()` for any dynamic input, as it executes in a shell and is vulnerable to command injection. Use `child_process.spawn()` or `execFile()` which bypass the shell and pass arguments directly.

```typescript
import { spawn } from 'node:child_process';

// Safe: arguments are passed as an array
const child = spawn('ls', ['-lh', '/usr']);
```

## 4. Modern APIs

- **Native Fetch**: Use the native `fetch` API (Node 18+) instead of third-party libraries like `axios` or `node-fetch` unless specific interceptor functionality is required.
- **Prefixes**: Always use the `node:` prefix when importing core modules (e.g., `import fs from 'node:fs'`). This explicitly bypasses `node_modules` lookup and improves security.
