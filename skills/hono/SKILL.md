---
name: hono
description: |
  Hono framework best practices. Use when building, reviewing, or debugging Hono applications, especially on Cloudflare Workers. Covers routing, middleware, context (c), and RPC patterns. Do NOT trigger for generic 'build a server' requests unless Hono or Cloudflare Workers is explicitly requested.
---

# Hono Framework Guidelines

This skill defines the standards for building ultra-fast web applications using Hono, primarily targeted at edge runtimes like Cloudflare Workers.

## 1. Core Principles

- **Standard Request/Response**: Hono is built on Web Standards. Familiarize yourself with standard `Request` and `Response` objects.
- **Context (`c`)**: The `Context` object is central to Hono. It wraps the request, response, and environment bindings.
- **Middleware-First**: Prefer composing small, focused middleware over large handler functions.
- **RPC (`hono/client`)**: Use Hono's RPC feature for end-to-end type safety between backend routes and frontend clients.

## 2. Environment Variables & Bindings (Cloudflare Workers)

Always strictly type your environment bindings for Cloudflare Workers.

```typescript
import { Hono } from 'hono'

type Bindings = {
  DB: D1Database
  API_KEY: string
}

const app = new Hono<{ Bindings: Bindings }>()

app.get('/', (c) => {
  const db = c.env.DB
  return c.text('Hello Hono!')
})
```

## 3. Middleware Usage

Always use the built-in middleware for common tasks.
- `cors()` for CORS.
- `secureHeaders()` for security headers.
- `logger()` for request logging.

```typescript
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'

app.use('*', cors())
app.use('*', secureHeaders())
```

## 4. Routing & Validation

Use `zodValidator` from `@hono/zod-validator` to validate inputs securely.

```typescript
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'

app.post(
  '/post',
  zValidator('json', z.object({
    title: z.string(),
    body: z.string()
  })),
  (c) => {
    const { title, body } = c.req.valid('json')
    return c.json({ title, body })
  }
)
```

## 5. Security Gates

- **Input Validation**: Never trust client input. Always validate using Zod.
- **Secrets**: Do not hardcode secrets. Always use `c.env`.
- **SQL Injection**: When using D1 or SQLite, always use parameterized queries or an ORM like Drizzle. Never concatenate user input into SQL strings.
