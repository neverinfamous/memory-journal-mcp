---
name: workers-best-practices
description: (APPLICATION CODE ONLY) Reviews and authors Cloudflare Workers code against production best practices. Use ONLY when writing or reviewing Worker code, configuring wrangler.jsonc, or checking for anti-patterns. Do NOT use for general Cloudflare product discovery (use cloudflare instead) or CLI management (use wrangler instead). NOT for Docker or general MCP servers. Do NOT trigger for generic 'build a server' requests unless the platform is explicitly specified as Cloudflare Workers.
---

Your knowledge of Cloudflare Workers APIs, types, and configuration may be outdated. **Prefer retrieval over pre-training** for any Workers code task — writing or reviewing.

## Retrieval Sources

Fetch the **latest** versions before writing or reviewing Workers code. Do not rely on baked-in knowledge for API signatures, config fields, or binding shapes.

| Source                 | How to retrieve                                                                          | Use for                                       |
| ---------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------- |
| Workers best practices | Fetch `https://developers.cloudflare.com/workers/best-practices/workers-best-practices/` | Canonical rules, patterns, anti-patterns      |
| Workers types          | See `references/review.md` for retrieval steps                                           | API signatures, handler types, binding types  |
| Wrangler config schema | `node_modules/wrangler/config-schema.json`                                               | Config fields, binding shapes, allowed values |
| Cloudflare docs        | Search tool or `https://developers.cloudflare.com/workers/`                              | API reference, compatibility dates/flags      |

## FIRST: Fetch Latest References

Before reviewing or writing Workers code, retrieve the current best practices page and relevant type definitions. If the project's `node_modules` has an older version, **prefer the latest published version**.

```bash
# Fetch latest workers types
mkdir -p /tmp/workers-types-latest && \
  npm pack @cloudflare/workers-types --pack-destination /tmp/workers-types-latest && \
  tar -xzf /tmp/workers-types-latest/cloudflare-workers-types-*.tgz -C /tmp/workers-types-latest
# Types at /tmp/workers-types-latest/package/index.d.ts
```

## Reference Documentation

- `references/rules.md` — all best practice rules with code examples and anti-patterns
- `references/review.md` — type validation, config validation, binding access patterns, review process

## Rules Quick Reference

### Configuration

| Rule               | Summary                                                                                 |
| ------------------ | --------------------------------------------------------------------------------------- |
| Compatibility date | Set `compatibility_date` to today on new projects; update periodically on existing ones |
| nodejs_compat      | Enable the `nodejs_compat` flag — many libraries depend on Node.js built-ins            |
| wrangler types     | Run `wrangler types` to generate `Env` — never hand-write binding interfaces            |
| Secrets            | Use `wrangler secret put`, never hardcode secrets in config or source                   |
| wrangler.jsonc     | Use JSONC config for non-secret settings — newer features are JSON-only                 |

### Request & Response Handling

| Rule      | Summary                                                                         |
| --------- | ------------------------------------------------------------------------------- |
| Streaming | Stream large/unknown payloads — never `await response.text()` on unbounded data |
| waitUntil | Use `ctx.waitUntil()` for post-response work; do not destructure `ctx`          |

### Architecture

| Rule               | Summary                                                                    |
| ------------------ | -------------------------------------------------------------------------- |
| Bindings over REST | Use in-process bindings (KV, R2, D1, Queues) — not the Cloudflare REST API |
| Queues & Workflows | Move async/background work off the critical path                           |
| Service bindings   | Use service bindings for Worker-to-Worker calls — not public HTTP          |
| Hyperdrive         | Always use Hyperdrive for external PostgreSQL/MySQL connections            |

### Observability

| Rule          | Summary                                                                                 |
| ------------- | --------------------------------------------------------------------------------------- |
| Logs & Traces | Enable `observability` in config with `head_sampling_rate`; use structured JSON logging |

### Code Patterns

| Rule                    | Summary                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------- |
| No global request state | Never store request-scoped data in module-level variables                             |
| Floating promises       | Every Promise must be `await`ed, `return`ed, `void`ed, or passed to `ctx.waitUntil()` |

### Security

| Rule                      | Summary                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------- |
| Web Crypto                | Use `crypto.randomUUID()` / `crypto.getRandomValues()` — never `Math.random()` for security |
| No passThroughOnException | Use explicit try/catch with structured error responses                                      |

## Anti-Patterns to Flag

| Anti-pattern                                     | Why it matters                                     |
| ------------------------------------------------ | -------------------------------------------------- |
| `await response.text()` on unbounded data        | Memory exhaustion — 128 MB limit                   |
| Hardcoded secrets in source or config            | Credential leak via version control                |
| `Math.random()` for tokens/IDs                   | Predictable, not cryptographically secure          |
| Bare `fetch()` without `await` or `waitUntil`    | Floating promise — dropped result, swallowed error |
| Module-level mutable variables for request state | Cross-request data leaks, stale state, I/O errors  |

See **[anti-patterns.md](references/anti-patterns.md)** for the complete list of anti-patterns.

## Review Workflow

1. **Retrieve** — fetch latest best practices page, workers types, and wrangler schema
2. **Read full files** — not just diffs; context matters for binding access patterns
3. **Check types** — binding access, handler signatures, no `any`, no unsafe casts (see `references/review.md`)
4. **Check config** — compatibility_date, nodejs_compat, observability, secrets, binding-code consistency
5. **Check patterns** — streaming, floating promises, global state, serialization boundaries
6. **Check security** — crypto usage, secret handling, timing-safe comparisons, error handling
7. **Validate with tools** — `npx tsc --noEmit`, lint for `no-floating-promises`
8. **Reference rules** — see `references/rules.md` for each rule's correct pattern

## Scope

This skill covers Workers-specific best practices and code review. For related topics:

- **Durable Objects**: load the `durable-objects` skill
- **Workflows**: see [Rules of Workflows](https://developers.cloudflare.com/workflows/build/rules-of-workflows/)
- **Wrangler CLI commands**: load the `wrangler` skill

## Principles

- **Be certain.** Retrieve before flagging. If unsure about an API, config field, or pattern, fetch the docs first.
- **Provide evidence.** Reference line numbers, tool output, or docs links.
- **Focus on what developers will copy.** Workers code in examples and docs gets pasted into production.
- **Correctness over completeness.** A concise example that works beats a comprehensive one with errors.
