---
name: typescript
description: |
  Comprehensive enterprise-grade TypeScript operational guide.
  Use when configuring TS projects, writing complex generics, or enforcing strict type safety.
  Triggers on "TypeScript", "tsconfig.json", "generics", "type errors", "strict mode".
  SECURITY: Do not bypass type checks with 'any' or '@ts-ignore'.
disable-model-invocation: true
---

# TypeScript Operational Guide

Enterprise-grade rules for writing resilient, type-safe TypeScript in 2026. Follow these standards when refactoring, writing new code, or configuring projects.

## 1. Type Safety Mandates

- **Never use `any`**: Use `unknown` for unstructured data and narrow it with strict type guards or `typeof`/`instanceof` checks.
- **Avoid `as` assertions**: Casting subverts the type system. Use the `satisfies` operator to validate shape without widening, or use strict type guards to preserve inference.
- **Use Unions over Enums**: Prefer literal union types (`type Status = "active" | "inactive"`). Only use `const enum` when an intentional zero-overhead interop contract is required. Enums create unnecessary runtime footprint and complex mapping issues.
- **Boundary Validation**: Always use `Zod` (or equivalent schema validation) to parse unknown data at system boundaries (API payloads, database reads, file I/O). Never blindly cast external payloads.

## 2. Project Configuration (`tsconfig.json`)

Unless explicitly directed otherwise by the user or existing ecosystem:
- **Module System**: Assume an `ESM-first` setup. Ensure `"type": "module"` is in `package.json`.
- **Strict Mode**: Ensure `"strict": true` is enabled.
- **Module Resolution**: Use `"moduleResolution": "Bundler"` or `"Node16"` for modern ESM.

## 3. Generics and Utility Types

- Keep generics constrained (`<T extends Record<string, unknown>>`) to avoid over-broad type matching.
- Prefer built-in utility types (`Record`, `Partial`, `Omit`, `Pick`, `Awaited`) over custom mapped types when possible.
- Use `Readonly<T>` for props and configurations that shouldn't mutate.

## 4. Error Handling

- Avoid throwing untyped objects. Throw `Error` subclasses.
- Use `unknown` in catch blocks (e.g., `catch (error: unknown)`) and check `error instanceof Error` before accessing `.message`.

## 5. Security & Linting

- Do not bypass quality checks using `@ts-ignore`, `@ts-expect-error`, or `@ts-nocheck` unless mandated by an unavoidable upstream bug.
- Avoid using `eslint-disable` to silence legitimate typing complaints.

## 6. Deep References

For comprehensive tutorials or ecosystem-specific patterns, consult:
- **[TypeScript Tutorial & Deep Dive](references/tutorial.md)**
