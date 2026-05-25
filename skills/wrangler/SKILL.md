---
name: wrangler
description: |
  Cloudflare Wrangler CLI dispatcher. Use ONLY when explicitly deploying code to Cloudflare Workers or managing Cloudflare bindings using the wrangler CLI. 
  Do NOT use for general Cloudflare product discovery (use cloudflare instead) or for writing/reviewing Worker code (use workers-best-practices instead).
---

# Wrangler CLI

This skill provides references for the Cloudflare Wrangler CLI. The CLI is extensive, so command references are split by product.

## Security Gates (CRITICAL)

- **Confirmation Required:** You MUST ask for user confirmation before executing any `deploy`, `delete`, `drop`, or `secret put` commands.
- **Never Log Secrets:** Never print secret values to the terminal or save them in logs/artifacts.

## References

Before executing a Wrangler command, read the corresponding reference file to ensure you have the correct syntax.

- **[Full CLI Commands Reference](references/cli-commands.md)**: Contains all commands for Workers, Pages, KV, R2, D1, Vectorize, Hyperdrive, Queues, Pipelines, Containers, Workflows, Observability, and Secrets.

## Quick Reference (Top Commands)

| Command | Description |
|---------|-------------|
| `npx wrangler dev` | Start local development server |
| `npx wrangler deploy` | Deploy to production |
| `npx wrangler tail` | Tail production logs |
| `npx wrangler secret put <name>` | Create/update a secret |
| `npx wrangler d1 execute <db> --local --file=...` | Execute SQL locally |
| `npx wrangler kv:key put --binding=<name> <key> <value>` | Put KV pair |
| `npx wrangler r2 object put <bucket>/<key> --file=...` | Upload R2 object |
| `npx wrangler types` | Generate TS types from config |
| `npx wrangler login` | Authenticate CLI |
| `npx wrangler whoami` | Check auth status |

## Local Development Workflow

1. Start dev server: `npx wrangler dev`
2. Generate types from config: `npx wrangler types`
3. Tail production logs: `npx wrangler tail`
