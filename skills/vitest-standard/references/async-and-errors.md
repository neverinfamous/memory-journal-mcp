# Async & Error Handling in Vitest

Handling promises and rejections correctly is essential for preventing flakiness and false positives.

## Async Testing

### Promises
Always use `await` inside your tests to ensure Vitest waits for fulfillment.
```typescript
it('should fetch data', async () => {
  const data = await fetchData();
  expect(data).toEqual({ id: 1 });
});
```

### Async Error Handling
Use `rejects.toThrow()` to assert a promise is rejected with a specific message.
```typescript
it('should handle API errors', async () => {
  await expect(api.fetchUser('invalid')).rejects.toThrow('User not found');
});
```

## Error Handling Patterns

### Synchronous Errors
Assert that calling a function throws an error directly.
```typescript
it('should throw for negative numbers', () => {
  expect(() => sqrt(-1)).toThrow('Cannot compute square root of negative');
});
```

### Specialized Error Types
Validate against specific error classes.
```typescript
it('should throw TypeError', () => {
  expect(() => doSomething()).toThrow(TypeError);
});

it('should throw CustomValidationError', () => {
  expect(() => validate()).toThrow(ValidationError);
});
```

## Common Failures
- **Missing `await`**: Tests frequently pass silently because the promise was never resolved.
- **`try/catch` in tests**: Don't use `try/catch` in your test bodies. Use the `toThrow()` or `rejects.toThrow()` assertions directly.
- **Unbounded Timeouts**: Ensure your async tests can time out (default is 5s) instead of hanging your CI pipeline.
