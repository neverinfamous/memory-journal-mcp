# Project Config Templates

Full templates for project configuration files. Read on demand when setting up a new repo.

---

## tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "incremental": true,
    "tsBuildInfoFile": "./dist/.tsbuildinfo",
    "skipLibCheck": true,
    /* Strict Type-Checking Options */
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictBindCallApply": true,
    "strictPropertyInitialization": true,
    "noImplicitThis": true,
    "useUnknownInCatchVariables": true,
    "alwaysStrict": true,
    "exactOptionalPropertyTypes": true,
    /* Additional Checks */
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noPropertyAccessFromIndexSignature": true,
    "allowUnusedLabels": false,
    "allowUnreachableCode": false,
    "noUncheckedSideEffectImports": true,
    /* Module Resolution */
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "declaration": true,
    "declarationMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts", "**/*.spec.ts"]
}
```

> **Note**: If `exactOptionalPropertyTypes` causes issues with third-party types, set it to `false` (as memory-journal-mcp does).

---

## eslint.config.js

ESLint 10 with strict type-checking for source + relaxed config for test files. The `no-console` rule is critical for MCP servers — `console.log()` writes to stdout and corrupts stdio transport.

```javascript
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage'] },
  // Main source configuration
  {
    extends: [
      js.configs.recommended,
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
    ],
    files: ['src/**/*.ts'],
    ignores: ['**/__tests__/**', '**/*.test.ts', '**/*.spec.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        ...globals.node,
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Strict rules - type safety
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': [
        'error',
        {
          allowExpressions: true,
          allowTypedFunctionExpressions: true,
          allowHigherOrderFunctions: true,
          allowDirectConstAssertionInArrowFunctions: true,
          allowConciseArrowFunctionExpressionsStartingWithVoid: true,
        },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/strict-boolean-expressions': [
        'error',
        {
          allowNullableBoolean: true,
          allowNullableString: true,
          allowNullableNumber: false,
          allowNullableObject: true,
        },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': [
        'error',
        {
          checksVoidReturn: {
            attributes: false,
            properties: false,
          },
        },
      ],
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/prefer-nullish-coalescing': [
        'error',
        {
          ignorePrimitives: { string: true, number: true },
        },
      ],
      '@typescript-eslint/prefer-optional-chain': 'error',
      // Unsafe any rules
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        {
          allowNumber: true,
          allowBoolean: true,
        },
      ],
      '@typescript-eslint/restrict-plus-operands': [
        'error',
        {
          allowNumberAndString: true,
          allowAny: true,
        },
      ],
      '@typescript-eslint/no-confusing-void-expression': [
        'error',
        {
          ignoreArrowShorthand: true,
          ignoreVoidOperator: true,
        },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          prefer: 'type-imports',
          fixStyle: 'inline-type-imports',
        },
      ],
      '@typescript-eslint/consistent-type-exports': 'error',
      '@typescript-eslint/no-misused-spread': 'off',
      // Prevent console.log() which writes to stdout and corrupts MCP stdio transport
      // Only stderr output (error, warn) is safe for MCP servers
      'no-console': ['error', { allow: ['error', 'warn'] }],
    },
  },
  // Test file configuration - catches unused imports/vars but relaxes
  // type-safety rules that conflict with test patterns (mocks, any casts)
  {
    files: ['src/**/__tests__/**/*.ts', 'src/**/*.test.ts', 'src/**/*.spec.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // Core quality rules that should apply to tests
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' },
      ],
      // Relax type-safety rules for test patterns (mocks, any casts, assertions)
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },
);
```

---

## tsup.config.ts

```typescript
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node24',
  outDir: 'dist',
});
```

> **Note**: Add additional entry points as needed (e.g., `src/cli.ts` for CLI binaries).

---

## vitest.config.ts

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    testTimeout: 10000,
    hookTimeout: 10000,
  },
});
```

---

## .prettierrc

```json
{
  "semi": false,
  "singleQuote": true,
  "tabWidth": 4,
  "useTabs": false,
  "trailingComma": "es5",
  "printWidth": 100,
  "bracketSpacing": true,
  "arrowParens": "always",
  "endOfLine": "auto",
  "proseWrap": "preserve",
  "overrides": [
    {
      "files": ["*.json", "*.jsonc"],
      "options": {
        "tabWidth": 4
      }
    },
    {
      "files": ["*.yaml", "*.yml"],
      "options": {
        "tabWidth": 2
      }
    },
    {
      "files": ["*.md"],
      "options": {
        "tabWidth": 2,
        "proseWrap": "preserve"
      }
    }
  ]
}
```

---

## .prettierignore

```
# Build output
dist/
build/

# Dependencies
node_modules/

# Package manager files
package-lock.json
pnpm-lock.yaml

# Logs
*.log

# Generated
*.min.js
*.min.css

# Database files
*.db
*.sqlite
```

---

## .gitleaks.toml

```toml
# Gitleaks Configuration
# https://github.com/gitleaks/gitleaks#configuration

title = "{{REPO_NAME}} gitleaks config"

# Allowlist for known false positives in test fixtures
[allowlist]
  description = "Test fixtures containing intentionally fake secrets"
  paths = []
```
