# Vitest Assertions Quick Reference

| Assertion                | Purpose                        |
| :----------------------- | :----------------------------- |
| `toBe(val)`              | Strict equality (`===`)        |
| `toEqual(val)`           | Deep equality (objects/arrays) |
| `toMatchObject(obj)`     | Partial match on an object     |
| `toThrow(error?)`        | Validates a thrown error       |
| `toHaveBeenCalledWith()` | Verifies mock call arguments   |
| `resolves.toEqual()`     | Validates a fulfilled promise  |
| `rejects.toThrow()`      | Validates a rejected promise   |
