---
name: typescript
description: |
  High-level operational guide for TypeScript development. Use when establishing TS configurations, writing complex generics, or enforcing strict type safety in a project.
---

# TypeScript Operational Guide

When asked to write or refactor TypeScript code, follow this operational workflow.

## 1. Type Safety Mandates

- **Never use `any`**: Use `unknown` and narrow with strict type guards.
- **Avoid `as` assertions**: Use the `satisfies` operator or type guards to preserve inference.
- **Use Unions over Enums**: Use literal union types (`type Status = "active" | "inactive"`) instead of `enum`s to prevent runtime footprints and mapping issues.
- **Validate Boundaries**: Use `Zod` (or equivalent schema validation) to validate unknown data at system boundaries (e.g., API payloads, database reads, file I/O).

## 2. Configuration Standards

Unless otherwise directed:
- Assume an `ESM-first` setup (`"type": "module"` in `package.json`).
- Ensure `"strict": true` is enabled in `tsconfig.json`.

## 3. Deep References

For comprehensive tutorials, deep-dives on Generics, React patterns, or LangChain examples, consult the full reference:

- **[TypeScript Tutorial & Deep Dive](references/tutorial.md)**
