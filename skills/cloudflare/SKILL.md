---
name: cloudflare
description: General Cloudflare platform skill for infrastructure, storage, and networking. Use when choosing between Cloudflare products (KV vs D1 vs R2) or doing general Cloudflare tasks. Do NOT use for code-reviewing Workers (use workers-best-practices instead) or for CLI deployment/management (use wrangler instead). NOT for orchestrating CI/CD pipelines (use github-actions instead).
references:
  - workers
  - pages
  - d1
  - durable-objects
  - workers-ai
---

# Cloudflare Platform Skill

Consolidated skill for building on the Cloudflare platform. Use decision trees below to find the right product, then load detailed references.

Your knowledge of Cloudflare APIs, types, limits, and pricing may be outdated. **Prefer retrieval over pre-training** — the references in this skill are starting points, not source of truth.

## Retrieval Sources

Fetch the **latest** information before citing specific numbers, API signatures, or configuration options. Do not rely on baked-in knowledge or these reference files alone.

| Source | How to retrieve | Use for |
|--------|----------------|---------|
| Cloudflare docs | `cloudflare-docs` search tool or `https://developers.cloudflare.com/` | Limits, pricing, API reference, compatibility dates/flags |
| Workers types | `npm pack @cloudflare/workers-types` or check `node_modules` | Type signatures, binding shapes, handler types |
| Wrangler config schema | `node_modules/wrangler/config-schema.json` | Config fields, binding shapes, allowed values |
| Product changelogs | `https://developers.cloudflare.com/changelog/` | Recent changes to limits, features, deprecations |

When a reference file and the docs disagree, **trust the docs**. This is especially important for: numeric limits, pricing tiers, type signatures, and configuration options.

## Quick Decision Trees

See **[decision-trees.md](references/decision-trees.md)** for routing logic across Cloudflare's product suite (compute, storage, AI, networking, security, etc.).

## Product Index

See [references/product-index.md](references/product-index.md) for the full mapping of Cloudflare products to their reference paths.
