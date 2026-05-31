# Cache Component Examples & Deep Dives

## Cache Invalidation

### `cacheTag()` - Tag Cached Content

```tsx
import { cacheTag } from 'next/cache'

async function getProducts() {
  'use cache'
  cacheTag('products')
  return db.products.findMany()
}

async function getProduct(id: string) {
  'use cache'
  cacheTag('products', `product-${id}`)
  return db.products.findUnique({ where: { id } })
}
```

### `updateTag()` - Immediate Invalidation

Use when you need the cache refreshed within the same request:

```tsx
'use server'

import { updateTag } from 'next/cache'

export async function updateProduct(id: string, data: FormData) {
  await db.products.update({ where: { id }, data })
  updateTag(`product-${id}`) // Immediate - same request sees fresh data
}
```

### `revalidateTag()` - Background Revalidation

Use for stale-while-revalidate behavior:

```tsx
'use server'

import { revalidateTag } from 'next/cache'

export async function createPost(data: FormData) {
  await db.posts.create({ data })
  revalidateTag('posts') // Background - next request sees fresh data
}
```

---

## Runtime Data Constraint

**Cannot** access `cookies()`, `headers()`, or `searchParams` inside `use cache`.

### Solution: Pass as Arguments

```tsx
// Wrong - runtime API inside use cache
async function CachedProfile() {
  'use cache'
  const session = (await cookies()).get('session')?.value // Error!
  return <div>{session}</div>
}

// Correct - extract outside, pass as argument
async function ProfilePage() {
  const session = (await cookies()).get('session')?.value
  return <CachedProfile sessionId={session} />
}

async function CachedProfile({ sessionId }: { sessionId: string }) {
  'use cache'
  // sessionId becomes part of cache key automatically
  const data = await fetchUserData(sessionId)
  return <div>{data.name}</div>
}
```

### Exception: `use cache: private`

For compliance requirements when you can't refactor:

```tsx
async function getData() {
  'use cache: private'
  const session = (await cookies()).get('session')?.value // Allowed
  return fetchData(session)
}
```

---

## Caching Security & Auth Boundaries

> **CRITICAL FAILURE MODE:** Caching user-specific or authorization-bound data globally will leak PII (Personally Identifiable Information) across different users' sessions.

**Rules for Auth Boundaries:**

1. **Never use standard `'use cache'` for PII:** Standard cache entries are shared globally. If a component fetches user profile data using an auth token, you MUST NOT use the standard global `'use cache'`.
2. **Explicitly include user identities in cache keys:** If you must cache per-user data, extract the user ID in a dynamic context and pass it as an argument so it becomes part of the automatic cache key (e.g., `async function CachedProfile({ userId }) { 'use cache'; ... }`).
3. **Use `'use cache: private'` cautiously:** This ensures data isn't shared across requests, but relies heavily on correct platform caching configuration.
4. **Dynamic by default for Auth:** For dashboards, settings, and secure data, default to **Dynamic** (Suspense) rather than Cached.

---

## Cache Key Generation

Cache keys are automatic based on:

- **Build ID** - invalidates all caches on deploy
- **Function ID** - hash of function location
- **Serializable arguments** - props become part of key
- **Closure variables** - outer scope values included

```tsx
async function Component({ userId }: { userId: string }) {
  const getData = async (filter: string) => {
    'use cache'
    // Cache key = userId (closure) + filter (argument)
    return fetch(`/api/users/${userId}?filter=${filter}`)
  }
  return getData('active')
}
```

---

## Complete Example

```tsx
import { Suspense } from 'react'
import { cookies } from 'next/headers'
import { cacheLife, cacheTag } from 'next/cache'

export default function DashboardPage() {
  return (
    <>
      {/* Static shell - instant from CDN */}
      <header>
        <h1>Dashboard</h1>
      </header>
      <nav>...</nav>

      {/* Cached - fast, revalidates hourly */}
      <Stats />

      {/* Dynamic - streams in with fresh data */}
      <Suspense fallback={<NotificationsSkeleton />}>
        <Notifications />
      </Suspense>
    </>
  )
}

async function Stats() {
  'use cache'
  cacheLife('hours')
  cacheTag('dashboard-stats')

  const stats = await db.stats.aggregate()
  return <StatsDisplay stats={stats} />
}

async function Notifications() {
  const userId = (await cookies()).get('userId')?.value
  const notifications = await db.notifications.findMany({
    where: { userId, read: false },
  })
  return <NotificationList items={notifications} />
}
```

---

## Migration from Previous Versions

| Old Config                  | Replacement                        |
| --------------------------- | ---------------------------------- |
| `experimental.ppr`          | `cacheComponents: true`            |
| `dynamic = 'force-dynamic'` | Remove (default behavior)          |
| `dynamic = 'force-static'`  | `'use cache'` + `cacheLife('max')` |
| `revalidate = N`            | `cacheLife({ revalidate: N })`     |
| `unstable_cache()`          | `'use cache'` directive            |

### Migrating `unstable_cache` to `use cache`

`unstable_cache` has been replaced by the `use cache` directive in Next.js 16. When `cacheComponents` is enabled, convert `unstable_cache` calls to `use cache` functions:

**Before (`unstable_cache`):**

```tsx
import { unstable_cache } from 'next/cache'

const getCachedUser = unstable_cache(async (id) => getUser(id), ['my-app-user'], {
  tags: ['users'],
  revalidate: 60,
})

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await getCachedUser(id)
  return <div>{user.name}</div>
}
```

**After (`use cache`):**

```tsx
import { cacheLife, cacheTag } from 'next/cache'

async function getCachedUser(id: string) {
  'use cache'
  cacheTag('users')
  cacheLife({ revalidate: 60 })
  return getUser(id)
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await getCachedUser(id)
  return <div>{user.name}</div>
}
```

Key differences:

- **No manual cache keys** - `use cache` generates keys automatically from function arguments and closures. The `keyParts` array from `unstable_cache` is no longer needed.
- **Tags** - Replace `options.tags` with `cacheTag()` calls inside the function.
- **Revalidation** - Replace `options.revalidate` with `cacheLife({ revalidate: N })` or a built-in profile like `cacheLife('minutes')`.
- **Dynamic data** - `unstable_cache` did not support `cookies()` or `headers()` inside the callback. The same restriction applies to `use cache`, but you can use `'use cache: private'` if needed.
