---
name: next-best-practices
description: Next.js and React performance optimization best practices - file conventions, RSC boundaries, data patterns, async APIs, Core Web Vitals, and bundle size. NOT for granular component caching strategies (use next-cache-components).
user-invocable: false
---

# Next.js Best Practices

Apply these rules when writing or reviewing Next.js code.

## Auto-Load Mechanism

This skill is configured with `user-invocable: false` to avoid trigger collisions with other Next.js/React skills. It acts as an implicit dependency that provides detailed file convention and RSC rules when navigating Next.js architectures.

## 1. File Conventions & Routing

- **App Router**: Always use the `app/` directory.
- **Middleware**: Use `middleware.ts` at the root for routing logic.
- **Parallel/Intercepting**: Use `@folder` for parallel routes and `(.)` for intercepting routes (e.g. modals).
- **Default**: Use `default.tsx` for fallbacks in parallel routes.

## 2. RSC Boundaries & Directives

- **Directives**: Use `'use client'` strictly at the boundary where client interactivity/hooks are required. Use `'use server'` for Server Actions.
- **Caching**: Use `'use cache'` (Next.js 15+) for caching functions or components.
- **Async Client Components**: Async React Client Components are invalid. You cannot `await` inside a Client Component; use `use(promise)` instead.
- **Serialization**: Props passed from Server to Client components must be serializable (no classes/functions without Server Actions).

## 3. Async APIs (Next.js 15+)

- **Dynamic APIs**: `params`, `searchParams`, `cookies()`, and `headers()` are now ASYNC and must be `await`ed before use.
- **Route Handlers**: The `request` object in Route Handlers should be used carefully; prefer Server Actions for mutations.

## 4. Functions & Error Handling

- **Navigation**: Use `useRouter()`, `usePathname()`, `useSearchParams()`, `useParams()` from `next/navigation`.
- **Errors**: Use `error.tsx` for React error boundaries. Use `redirect()` or `notFound()` for control flow.
- **Catch Blocks**: Use `unstable_rethrow` inside generic catch blocks to avoid catching internal Next.js thrown errors (like redirect).

## 5. Data Patterns

- **Waterfalls**: Avoid data waterfalls by using `Promise.all()` for independent fetches, or preloading data.
- **Client Fetching**: Use SWR or React Query for client-side data fetching. Do not use `useEffect` for data fetching.

## 6. Optimizations

- **Images**: Always use `next/image` (`<Image>`) with `sizes` for responsiveness and `priority` for LCP images.
- **Fonts**: Use `next/font/google` or `next/font/local` to avoid CLS.
- **Scripts**: Use `next/script` (`<Script>`) with appropriate `strategy` (e.g. `afterInteractive`).
- **Bundling**: Avoid barrel files (`index.ts` re-exporting everything) to improve bundle size and tree-shaking.

## 7. Security (Critical)

- **SSRF Prevention**: Never pass unsanitized user input directly to `fetch()` URLs in Server Components or Route Handlers. Always validate and sanitize input, and construct URLs using the `URL` API.
- **Cache Data Leaks**: Be extremely careful with Next.js aggressive caching. Never use `fetch()` without `{ cache: 'no-store' }` or similar cache opt-outs when fetching user-specific or sensitive data.
- **Server Actions**: Always verify authorization and re-validate inputs inside Server Actions. They are public API endpoints, even if they look like internal functions.

## 8. React Performance Guidelines (Vercel)

Comprehensive performance optimization guide for React and Next.js applications, maintained by Vercel. Contains rules across 8 categories, prioritized by impact to guide automated refactoring and code generation.

### Priority 1: Eliminating Waterfalls (CRITICAL)

- **`async-defer-await`**: Move `await` into branches where the data is actually used. Do not block the rendering of an entire component tree if only a deeply nested child requires the awaited data.

### Priority 2: Bundle Size Optimization (CRITICAL)

- **`bundle-barrel-imports`**: Avoid barrel files (`index.ts`). Import directly from submodules (e.g., `import { Button } from '@/components/ui/button'` instead of `import { Button } from '@/components'`).

### Priority 3: Server-Side Performance (HIGH)

- **`server-auth-actions`**: Explicitly authenticate all Server Actions and API routes. Do not assume context is protected just because it's called from a protected UI component.

### Priority 4: Client-Side Data Fetching (MEDIUM-HIGH)

- **`client-swr-dedup`**: Use `SWR` or React Query for automatic request deduplication on the client instead of raw `useEffect` fetches.

### Priority 5: Re-render Optimization (MEDIUM)

- **`rerender-defer-reads`**: Do not subscribe to state variables if they are only used inside an event callback. Use `useRef` for mutable values that do not require re-renders.

### Priority 6: Rendering Performance (MEDIUM)

- **`rendering-animate-svg-wrapper`**: When animating SVGs, animate the wrapping `div` instead of the internal SVG DOM nodes to leverage GPU acceleration.

_(For deeper details, consult the `references/_.md`and`rules/_.md` files when needed)._
