---
name: next-cache-components
description: |
  Next.js 16 Cache Components guidance. Use when refactoring React Server Components for performance, debugging Partial Prerendering (PPR) issues, or applying the `use cache` directive, `cacheLife`, `cacheTag`, `updateTag`, and `revalidateTag`.
  Also use when deciding whether data should be static, cached, or dynamic, or when addressing stale data and cache invalidation.
---

# Cache Components (Next.js 16+)

> **Note:** Cache Components are available in Next.js canary. Verify `cacheComponents` is supported in your target version before applying this guidance.

Cache Components enable Partial Prerendering (PPR) - mix static, cached, and dynamic content in a single route.

## Enable Cache Components

```ts
// next.config.ts
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  cacheComponents: true,
}

export default nextConfig
```

This replaces the old `experimental.ppr` flag.

---

## Three Content Types

With Cache Components enabled, content falls into three categories:

### 1. Static (Auto-Prerendered)

Synchronous code, imports, pure computations - prerendered at build time:

```tsx
export default function Page() {
  return (
    <header>
      <h1>Our Blog</h1>  {/* Static - instant */}
      <nav>...</nav>
    </header>
  )
}
```

### 2. Cached (`use cache`)

Async data that doesn't need fresh fetches every request:

```tsx
async function BlogPosts() {
  'use cache'
  cacheLife('hours')

  const posts = await db.posts.findMany()
  return <PostList posts={posts} />
}
```

### 3. Dynamic (Suspense)

Runtime data that must be fresh - wrap in Suspense:

```tsx
import { Suspense } from 'react'

export default function Page() {
  return (
    <>
      <BlogPosts />  {/* Cached */}

      <Suspense fallback={<p>Loading...</p>}>
        <UserPreferences />  {/* Dynamic - streams in */}
      </Suspense>
    </>
  )
}

async function UserPreferences() {
  const theme = (await cookies()).get('theme')?.value
  return <p>Theme: {theme}</p>
}
```

---

## Selection Matrix: Static vs Cached vs Dynamic

When designing a component, use this matrix to determine the correct caching strategy:

| Data Type | Frequency of Change | Strategy | Implementation |
|---|---|---|---|
| Marketing copy, Layouts, Nav | Build-time or rarely | **Static** | Default Server Component |
| Blog posts, Product catalog | Periodic / CMS-driven | **Cached** | `'use cache'` + `cacheLife` |
| User profile, Shopping cart | Per-user / Real-time | **Dynamic** | Suspense + `await cookies()` |
| Admin dashboard, Analytics | High-frequency / Secure | **Dynamic** | Suspense + `await headers()` |

---

## `use cache` Directive

### File Level

```tsx
'use cache'

export default async function Page() {
  // Entire page is cached
  const data = await fetchData()
  return <div>{data}</div>
}
```

### Component Level

```tsx
export async function CachedComponent() {
  'use cache'
  const data = await fetchData()
  return <div>{data}</div>
}
```

### Function Level

```tsx
export async function getData() {
  'use cache'
  return db.query('SELECT * FROM posts')
}
```

---

## Cache Profiles

### Built-in Profiles

```tsx
'use cache'                    // Default: 5m stale, 15m revalidate
```

```tsx
'use cache: remote'           // Platform-provided cache (Redis, KV)
```

```tsx
'use cache: private'          // For compliance, allows runtime APIs
```

### `cacheLife()` - Custom Lifetime

```tsx
import { cacheLife } from 'next/cache'

async function getData() {
  'use cache'
  cacheLife('hours')  // Built-in profile
  return fetch('/api/data')
}
```

Built-in profiles: `'default'`, `'minutes'`, `'hours'`, `'days'`, `'weeks'`, `'max'`

### Inline Configuration

```tsx
async function getData() {
  'use cache'
  cacheLife({
    stale: 3600,      // 1 hour - serve stale while revalidating
    revalidate: 7200, // 2 hours - background revalidation interval
    expire: 86400,    // 1 day - hard expiration
  })
  return fetch('/api/data')
}
```

## Deep Dives & Advanced Usage

For complete examples, migration strategies from `unstable_cache`, runtime constraints, and cache invalidation APIs (`cacheTag`, `updateTag`, `revalidateTag`), read the reference file:

**[Read: references/examples.md](references/examples.md)**

## Limitations

- **Edge runtime not supported** - requires Node.js
- **Static export not supported** - needs server
- **Non-deterministic values** (`Math.random()`, `Date.now()`) execute once at build time inside `use cache`

For request-time randomness outside cache:

```tsx
import { connection } from 'next/server'

async function DynamicContent() {
  await connection()  // Defer to request time
  const id = crypto.randomUUID()  // Different per request
  return <div>{id}</div>
}
```

Sources:
- [Cache Components Guide](https://nextjs.org/docs/app/getting-started/cache-components)
- [use cache Directive](https://nextjs.org/docs/app/api-reference/directives/use-cache)
- [unstable_cache (legacy)](https://nextjs.org/docs/app/api-reference/functions/unstable_cache)
