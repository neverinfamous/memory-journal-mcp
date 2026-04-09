---
name: vitest-standard
description: |
  Comprehensive unit testing expertise covering Vitest, test-driven 
  development (TDD), mocking strategies, and production-grade best practices. 
  Activates for unit testing, Vitest, TDD, Red-Green-Refactor, mocking, 
  stubbing, spying, test coverage, and test architecture in TypeScript/Node projects.
---

# Vitest Standard

This skill provides opinionated, production-tested guidance for high-integrity unit testing with Vitest. It emphasizes behavior-driven design, strictly isolated tests, and the TDD lifecycle.

## Golden Rules (Mandatory)

1.  **Test Behavior, Not Implementation** — Assert what the code *does*, not how it *looks* internally.
2.  **Strict Isolation** — NO shared state between tests. Create new instances in `beforeEach`.
3.  **Clean Mocks** — Use `vi.clearAllMocks()` in `beforeEach` to prevent call history leaks.
4.  **No Magic Numbers** — Use descriptive variables for expected values.
5.  **AAA Pattern** — Every test must follow Arrange-Act-Assert.
6.  **Async/Await** — Always await promises; use `rejects.toThrow()` for error paths.
7.  **Deterministic Tests** — No dependence on system time, environment variables, or randomness (mock them).
8.  **Meaningful Names** — Use `it('should [action] when [condition]')` or Given-When-Then.
9.  **Mock at Boundaries** — Mock external APIs, databases, and third-party SDKs; test your own logic.
10. **Red-Green-Refactor** — Prefer writing tests before code to drive API design.

## Core Patterns

### AAA (Arrange-Act-Assert)
```typescript
it('should calculate total price', () => {
  // Arrange: Setup data and environment
  const cart = new ShoppingCart();
  cart.addItem({ price: 10, quantity: 2 });

  // Act: Execute the method being tested
  const total = cart.getTotal();

  // Assert: Verify the outcome
  expect(total).toBe(20);
});
```

### Mocking Example
```typescript
import { vi, it, expect } from 'vitest';

it('mocks dependencies', () => {
  const mockFn = vi.fn().mockReturnValue(42);
  expect(mockFn()).toBe(42);
  expect(mockFn).toHaveBeenCalledOnce();
});
```

## Quick Reference: Assertions

| Assertion | Purpose |
| :--- | :--- |
| `toBe(val)` | Strict equality (`===`) |
| `toEqual(val)` | Deep equality (objects/arrays) |
| `toMatchObject(obj)` | Partial match on an object |
| `toThrow(error?)` | Validates a thrown error |
| `toHaveBeenCalledWith()` | Verifies mock call arguments |
| `resolves.toEqual()` | Validates a fulfilled promise |
| `rejects.toThrow()` | Validates a rejected promise |

---

## Specialized References (Load On-Demand)

| Scenario | Reference File |
| :--- | :--- |
| **Mocking & Doubles** | [mocking.md](references/mocking.md) |
| **Async & Error Handling** | [async-and-errors.md](references/async-and-errors.md) |
| **Coverage & Configuration** | [coverage-and-config.md](references/coverage-and-config.md) |
| **TDD Cycle** | [tdd-patterns.md](references/tdd-patterns.md) |

## Example: TDD Calculator
See [tdd-calculator.ts](examples/tdd-calculator.ts) for the Red-Green-Refactor workflow.
