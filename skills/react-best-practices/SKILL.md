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

## Quick Reference

### 1. Eliminating Waterfalls (CRITICAL)
- `async-defer-await` - Move await into branches where actually used
- *(See AGENTS.md for full list of 57 rules)*

### 2. Bundle Size Optimization (CRITICAL)
- `bundle-barrel-imports` - Import directly, avoid barrel files
- *(See AGENTS.md for full list)*

### 3. Server-Side Performance (HIGH)
- `server-auth-actions` - Authenticate server actions like API routes
- *(See AGENTS.md for full list)*

### 4. Client-Side Data Fetching (MEDIUM-HIGH)
- `client-swr-dedup` - Use SWR for automatic request deduplication
- *(See AGENTS.md for full list)*

### 5. Re-render Optimization (MEDIUM)
- `rerender-defer-reads` - Don't subscribe to state only used in callbacks
- *(See AGENTS.md for full list)*

### 6. Rendering Performance (MEDIUM)
- `rendering-animate-svg-wrapper` - Animate div wrapper, not SVG element
- *(See AGENTS.md for full list)*

### 7. JavaScript Performance (LOW-MEDIUM)
- `js-batch-dom-css` - Group CSS changes via classes or cssText
- *(See AGENTS.md for full list)*

### 8. Advanced Patterns (LOW)
- `advanced-event-handler-refs` - Store event handlers in refs
- *(See AGENTS.md for full list)*

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
