# TDD & Test Patterns

Test-Driven Development (TDD) facilitates better API design and ensures your code is testable from its inception.

## Red-Green-Refactor Cycle

1.  **Red**: Write a failing test for a specific feature.
2.  **Green**: Write the minimal amount of code to make the test pass.
3.  **Refactor**: Clean up the code without changing its behavior.

### Parametric Testing

Drive the same test logic with multiple data inputs.

```typescript
describe.each([
  [2, 3, 5],
  [10, 5, 15],
  [-1, 1, 0],
])('Calculator.add(%i, %i)', (a, b, expected) => {
  it(`should return ${expected}`, () => {
    const calc = new Calculator()
    expect(calc.add(a, b)).toBe(expected)
  })
})
```

### Given-When-Then (BDD Style)

Structure tests according to behavioral scenarios.

```typescript
describe('Shopping Cart', () => {
  it('should apply discount when total exceeds $100', () => {
    // Given: A cart with items totaling $120
    const cart = new ShoppingCart()
    cart.addItem({ price: 120, quantity: 1 })

    // When: Getting the total
    const total = cart.getTotal()

    // Then: 10% discount applied
    expect(total).toBe(108) // $120 - $12 (10%)
  })
})
```

## Naming & File Structure

### File Structure

- **Co-located tests**: `UserService.ts` and `UserService.test.ts` in the same directory.
- **Integration tests**: Place in a separate `tests/integration/` directory.

### Naming Conventions

- ✅ `it('should return error on missing email')`
- ✅ `it('returns error on missing email')`
- ❌ `it('test1')`
- ❌ `it('it should work')`
