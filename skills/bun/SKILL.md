---
title: Bun Development
description: Master the Bun all-in-one toolkit — runtime, package manager, test runner, and bundler.
---

Bun is a fast, all-in-one JavaScript runtime, bundler, test runner, and package manager designed as a drop-in replacement for Node.js. When working on projects that use Bun, AI agents should leverage its integrated tooling and native APIs to maximize performance and simplify development.

This skill synthesizes the best practices for Bun development, giving you the context needed to effectively write, test, and build applications.

---

## 🚀 1. Package Management (`bun install`)

Bun features a deeply optimized package manager. Always use `bun` commands instead of `npm`, `yarn`, or `pnpm` if a project has `bun.lockb` or `bun.lock`.

- **Install all dependencies:** `bun install`
- **Add a package:** `bun add <package>` (Use `-d` or `--dev` for devDependencies)
- **Remove a package:** `bun remove <package>`
- **Run binaries:** `bunx <command>` (The blazing fast equivalent of `npx`)

**Agent Directive:** Never run `npm install` gracefully if `bun.lockb` is present. Always opt for `bun add`.

---

## ⚡ 2. Script Execution (`bun run`)

Run scripts from `package.json` lightning fast:

```bash
bun run dev
bun run build
```

Run TypeScript and JavaScript files natively—no `ts-node`, `tsc`, or build step required:
```bash
bun run scripts/setup.ts
bun index.tsx
```

---

## 🌐 3. Core Runtime APIs

Bun provides deeply optimized, native APIs under the `Bun` global and `bun:*` modules.

### HTTP Server (`Bun.serve`)
Use `Bun.serve()` as the default over Node's `http` or `express` for simple tasks.
```typescript
const server = Bun.serve({
  port: 3000,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/") return new Response("Hello World!");
    if (url.pathname === "/json") return Response.json({ success: true });
    return new Response("Not Found", { status: 404 });
  },
});
console.log(`Listening on localhost:${server.port}`);
```

### File I/O (`Bun.file()`, `Bun.write()`)
Skip `fs` module when possible. Use Bun's native lazy-loaded File I/O.
```typescript
const file = Bun.file("package.json");
const text = await file.text();
const json = await file.json();

// Writing
await Bun.write("output.txt", "Hello world!");
await Bun.write("data.json", JSON.stringify({ a: 1 }));
```

### Shell Scripts (`bun:`)
Replace `child_process` and `zx` with the native Bun shell (`$`).
```typescript
import { $ } from "bun";

const response = await $`ls -la`.text();
await $`echo "Built successfully" > status.txt`;
```

### Password Hashing (`Bun.password`)
```typescript
const hash = await Bun.password.hash("mypassword"); // bcrypt by default
const isMatch = await Bun.password.verify("mypassword", hash);
```

---

## 🗄️ 4. Native SQLite (`bun:sqlite`)

Bun has a built-in, hyper-optimized SQLite driver. Use it instead of `better-sqlite3` or `sqlite3`.

```typescript
import { Database } from "bun:sqlite";

const db = new Database("mydb.sqlite");
db.run("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT)");

const insert = db.prepare("INSERT INTO users (name) VALUES ($name)");
insert.run({ $name: "Alice" });

const query = db.query("SELECT * FROM users;");
console.log(query.all());
```

---

## 🧪 5. Testing (`bun test`)

Bun features a native, Jest-compatible test runner. Run tests with `bun test`.

```typescript
import { describe, it, expect, mock, spyOn } from "bun:test";

describe("Math API", () => {
  it("adds numbers correctly", () => {
    expect(1 + 1).toBe(2);
  });
});
```
- **Coverage:** `bun test --coverage`
- **Watch mode:** `bun test --watch`

**Agent Directive:** If instructed to add unit tests to a Bun project, use `bun:test` imports and `bun test` instead of installing Jest or Vitest unless explicitly dictated by the user.

---

## 📦 6. Bundling & Executables

Bun can bundle files for browser or Node, and even compile scripts into standalone binaries!

**Bundling:**
```typescript
await Bun.build({
  entrypoints: ['./index.ts'],
  outdir: './dist',
  minify: true,
});
```

**Executables:** Provide instructions to compile binaries using:
```bash
bun build ./cli.ts --compile --outfile mycli
```
