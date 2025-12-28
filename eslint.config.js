import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
    { ignores: ['dist', 'node_modules', '**/__tests__/**', '**/*.test.ts', '**/*.spec.ts'] },
    // Main source configuration
    {
        extends: [
            js.configs.recommended,
            ...tseslint.configs.strictTypeChecked,
            ...tseslint.configs.stylisticTypeChecked,
        ],
        files: ['src/**/*.ts'],
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
            '@typescript-eslint/explicit-function-return-type': ['error', {
                allowExpressions: true,
                allowTypedFunctionExpressions: true,
                allowHigherOrderFunctions: true,
                allowDirectConstAssertionInArrowFunctions: true,
                allowConciseArrowFunctionExpressionsStartingWithVoid: true,
            }],
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
            '@typescript-eslint/no-non-null-assertion': 'error',
            '@typescript-eslint/strict-boolean-expressions': ['error', {
                allowNullableBoolean: true,
                allowNullableString: true,
                allowNullableNumber: false,
                allowNullableObject: true,
            }],
            '@typescript-eslint/no-floating-promises': 'error',
            '@typescript-eslint/no-misused-promises': ['error', {
                checksVoidReturn: {
                    attributes: false,
                    properties: false,
                },
            }],
            '@typescript-eslint/await-thenable': 'error',
            '@typescript-eslint/require-await': 'error',
            '@typescript-eslint/no-unnecessary-condition': 'off',
            '@typescript-eslint/prefer-nullish-coalescing': ['error', {
                ignorePrimitives: { string: true, number: true },
            }],
            '@typescript-eslint/prefer-optional-chain': 'error',
            // Unsafe any rules
            '@typescript-eslint/no-unsafe-assignment': 'error',
            '@typescript-eslint/no-unsafe-member-access': 'error',
            '@typescript-eslint/no-unsafe-call': 'error',
            '@typescript-eslint/no-unsafe-return': 'error',
            '@typescript-eslint/no-unsafe-argument': 'error',
            '@typescript-eslint/restrict-template-expressions': ['error', {
                allowNumber: true,
                allowBoolean: true,
            }],
            '@typescript-eslint/restrict-plus-operands': ['error', {
                allowNumberAndString: true,
                allowAny: true,
            }],
            '@typescript-eslint/no-confusing-void-expression': ['error', {
                ignoreArrowShorthand: true,
                ignoreVoidOperator: true,
            }],
            '@typescript-eslint/consistent-type-imports': ['error', {
                prefer: 'type-imports',
                fixStyle: 'inline-type-imports',
            }],
            '@typescript-eslint/consistent-type-exports': 'error',
            '@typescript-eslint/no-misused-spread': 'off',
            // Prevent console.log() which writes to stdout and corrupts MCP stdio transport
            // Only stderr output (error, warn) is safe for MCP servers
            'no-console': ['error', { allow: ['error', 'warn'] }],
        },
    },
)
