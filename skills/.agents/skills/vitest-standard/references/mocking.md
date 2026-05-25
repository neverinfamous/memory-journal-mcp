# Mocking & Test Doubles

Vitest provides a rich API for isolating your code from its dependencies.

## Test Doubles

| Type     | Purpose                           | Use Case                      |
| :------- | :-------------------------------- | :---------------------------- |
| **Mock** | Verifies behavior (calls, args)   | `vi.fn()`                     |
| **Stub** | Returns predefined values         | `vi.fn().mockReturnValue(42)` |
| **Spy**  | Observes a real function          | `vi.spyOn(obj, 'method')`     |
| **Fake** | Working simplified implementation | A `FakeDatabase` using `Map`  |

## Mocking Strategies

### 1. Mocking Modules

Must be called at the top of your test file to intercept internal imports.

```typescript
vi.mock('./api', () => ({
  fetchUser: vi.fn().mockResolvedValue({ id: 1, name: 'John' }),
}))
```

### 2. Dependency Injection

Prefer passing dependencies via constructor to facilitate easy mocking.

```typescript
class UserService {
  constructor(private db: Database) {}
  async getUser(id: string) {
    return this.db.query('SELECT * FROM users WHERE id = ?', [id])
  }
}

// Test with mock instance
const mockDb = { query: vi.fn().mockResolvedValue({ id: '123' }) }
const service = new UserService(mockDb as any)
```

### 3. Cleanup & Restoration

Crucial for preventing call history leaks between tests.

```typescript
beforeEach(() => {
  vi.clearAllMocks() // Resets call history
})

afterEach(() => {
  vi.restoreAllMocks() // Restores original methods if spying
})
```

## Anti-Patterns

- **Testing implementation**: Mocking internal methods of the class under test.
- **Over-mocking**: Mocking so much that the test loses its connection to reality.
- **Mocking your own code**: Mocking other internal helpers instead of the external boundaries.
