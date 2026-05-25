---
name: react-best-practices
description: React and Next.js performance optimization guidelines from Vercel Engineering. Use ONLY when explicitly optimizing React/Next.js performance, Core Web Vitals, or bundle size. NOT for general React or Next.js feature development tasks. NOT for generic caching questions (use next-cache-components).
license: MIT
metadata:
  author: vercel
  version: '1.0.0'
---

# Vercel React Best Practices

Comprehensive performance optimization guide for React and Next.js applications, maintained by Vercel. Contains 57 rules across 8 categories, prioritized by impact to guide automated refactoring and code generation.

## When to Apply

Reference these guidelines when:

- Writing new React components or Next.js pages
- Implementing data fetching (client or server-side)
- Reviewing code for performance issues
- Refactoring existing React/Next.js code
- Optimizing bundle size or load times

## Rule Categories by Priority

| Priority | Category                  | Impact      | Prefix       |
| -------- | ------------------------- | ----------- | ------------ |
| 1        | Eliminating Waterfalls    | CRITICAL    | `async-`     |
| 2        | Bundle Size Optimization  | CRITICAL    | `bundle-`    |
| 3        | Server-Side Performance   | HIGH        | `server-`    |
| 4        | Client-Side Data Fetching | MEDIUM-HIGH | `client-`    |
| 5        | Re-render Optimization    | MEDIUM      | `rerender-`  |
| 6        | Rendering Performance     | MEDIUM      | `rendering-` |
| 7        | JavaScript Performance    | LOW-MEDIUM  | `js-`        |
| 8        | Advanced Patterns         | LOW         | `advanced-`  |

## Core Rules (Actionable)

### 1. Eliminating Waterfalls (CRITICAL)
- **`async-defer-await`**: Move `await` into branches where the data is actually used. Do not block the rendering of an entire component tree if only a deeply nested child requires the awaited data.

### 2. Bundle Size Optimization (CRITICAL)
- **`bundle-barrel-imports`**: Avoid barrel files (`index.ts`). Import directly from submodules (e.g., `import { Button } from '@/components/ui/button'` instead of `import { Button } from '@/components'`).

### 3. Server-Side Performance (HIGH)
- **`server-auth-actions`**: Explicitly authenticate all Server Actions and API routes. Do not assume context is protected just because it's called from a protected UI component.

### 4. Client-Side Data Fetching (MEDIUM-HIGH)
- **`client-swr-dedup`**: Use `SWR` or React Query for automatic request deduplication on the client instead of raw `useEffect` fetches.

### 5. Re-render Optimization (MEDIUM)
- **`rerender-defer-reads`**: Do not subscribe to state variables if they are only used inside an event callback. Use `useRef` for mutable values that do not require re-renders.

### 6. Rendering Performance (MEDIUM)
- **`rendering-animate-svg-wrapper`**: When animating SVGs, animate the wrapping `div` instead of the internal SVG DOM nodes to leverage GPU acceleration.

## How to Use

Read individual rule files for detailed explanations and code examples:

```
rules/async-parallel.md
rules/bundle-barrel-imports.md
```

Each rule file contains:

- Brief explanation of why it matters
- Incorrect code example with explanation
- Correct code example with explanation
- Additional context and references

## Full Compiled Document

For the complete guide with all rules expanded: `AGENTS.md`
