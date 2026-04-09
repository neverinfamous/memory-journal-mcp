# Coverage & Configuration

Mastering Vitest configuration ensures your tests run quickly and provide the metrics needed for production delivery.

## Configuration (vitest.config.ts)

A sample configuration for Node.js environments.

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true, // Enables describe, it, expect globally
    environment: 'node',
    include: ['**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      lines: 80, // Enforce min 80% coverage
      functions: 80,
      branches: 80,
      statements: 80,
    },
  },
})
```

## Coverage Best Practices

### ✅ DO:

- Aim for **80-90% coverage** as a baseline for healthy projects.
- Focus on **business logic** and critical paths.
- Test **edge cases** and error paths thoroughly.

### ❌ DON'T:

- **Chase 100% coverage** including boilerplate code (getters/setters).
- Test **framework code** or third-party libraries.
- Write fragile tests just to increase lines covered.

## CLI Workflow

- **`vitest`**: Run in watch mode during TDD sessions.
- **`vitest run`**: Single execution for CI/CD or pre-commit hooks.
- **`vitest run --coverage`**: Generate coverage reports.
- **`vitest u`**: Update outdated snapshots after intentional changes.

### CI Integration

- Enable `reporters: ['default', 'junit']` for better integration with GitHub Actions or GitLab CI.
- Set `outputFile: 'junit.xml'` to capture results in CI artifacts.
