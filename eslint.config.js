import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
    {
        linterOptions: {
            reportUnusedDisableDirectives: 'error',
        },
    },
    { ignores: ['dist', 'node_modules', '**/__tests__/**', 'src/vendor/**', 'examples'] },
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
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
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
            // Repo bans TypeScript enums; disable costly enum checks across the type graph.
            '@typescript-eslint/no-unsafe-enum-assignment': 'off',
            '@typescript-eslint/no-unsafe-enum-comparison': 'off',
            '@typescript-eslint/no-deprecated': 'off',
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
                    disallowTypeAnnotations: true,
                },
            ],
            '@typescript-eslint/consistent-type-exports': 'error',
            '@typescript-eslint/ban-ts-comment': [
                'error',
                {
                    'ts-expect-error': true,
                    'ts-ignore': true,
                    'ts-nocheck': true,
                    'ts-check': false,
                },
            ],
            '@typescript-eslint/switch-exhaustiveness-check': 'error',
            'no-restricted-syntax': [
                'error',
                {
                    selector: 'TSEnumDeclaration',
                    message:
                        'Use string literal unions or `as const` objects instead of TypeScript enums.',
                },
                {
                    selector: "CallExpression[callee.object.name='z'][callee.property.name='any']",
                    message: 'Avoid z.any(); use z.unknown() or an explicit schema.',
                },
            ],
            'no-restricted-imports': [
                'error',
                {
                    paths: [
                        {
                            name: 'child_process',
                            importNames: ['exec', 'execSync'],
                            message:
                                'Use execFile/execFileSync with shell: false and windowsHide: true.',
                        },
                        {
                            name: 'node:child_process',
                            importNames: ['exec', 'execSync'],
                            message:
                                'Use execFile/execFileSync with shell: false and windowsHide: true.',
                        },
                    ],
                },
            ],
            'no-empty': 'error',
            'no-eval': 'error',
            'no-implied-eval': 'error',
            'no-new-func': 'error',
            'no-proto': 'error',
            'no-script-url': 'error',
            'no-extend-native': 'error',
            eqeqeq: ['error', 'always', { null: 'ignore' }],
            'prefer-object-has-own': 'error',
            'max-lines': ['error', { max: 500, skipBlankLines: false, skipComments: false }],
            'max-depth': ['warn', 4],
            'max-lines-per-function': ['warn', { max: 80, skipBlankLines: true, skipComments: true }],
            'no-await-in-loop': 'warn',
            '@typescript-eslint/no-unsafe-type-assertion': 'warn',
            '@typescript-eslint/no-misused-spread': 'off',
            // Prevent console.log() which writes to stdout and corrupts MCP stdio transport
            // Only stderr output (error, warn) is safe for MCP servers
            'no-console': ['error', { allow: ['error', 'warn'] }],
        },
    },
    // Test configuration (non-type-aware)
    {
        files: ['tests/**/*.ts', 'test-server/**/*.ts'],
        extends: [js.configs.recommended, ...tseslint.configs.recommended],
        languageOptions: {
            ecmaVersion: 2022,
            globals: {
                ...globals.node,
            },
        },
        rules: {
            // Base rules for tests without projectService type information
            '@typescript-eslint/no-unused-vars': 'off',
            // Tests can use any and non-null assertions safely
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-non-null-assertion': 'off',
            // Allow require() style imports for mocks
            '@typescript-eslint/no-require-imports': 'off',
            // Allow empty block statements in tests (e.g. catch (e) {})
            'no-empty': 'off',
            // Allow console mocking inside tests
            'no-console': 'off',
            // Allow generic Function types in mocks
            '@typescript-eslint/no-unsafe-function-type': 'off',
        },
    },
    // Scripts configuration (strict unused/any rules while permitting CLI console output)
    {
        files: ['scripts/**/*.ts', 'scripts/**/*.mjs'],
        extends: [js.configs.recommended, ...tseslint.configs.recommended],
        languageOptions: {
            ecmaVersion: 2022,
            globals: {
                ...globals.node,
            },
        },
        rules: {
            '@typescript-eslint/no-unused-vars': [
                'error',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                    caughtErrorsIgnorePattern: '^_',
                },
            ],
            '@typescript-eslint/no-explicit-any': 'error',
            'no-console': 'off',
        },
    },
    // Skills configuration (strict unused/any rules for executable skill helpers)
    {
        files: ['skills/**/*.ts', 'skills/**/*.mjs'],
        extends: [js.configs.recommended, ...tseslint.configs.recommended],
        languageOptions: {
            ecmaVersion: 2022,
            globals: {
                ...globals.node,
            },
        },
        rules: {
            '@typescript-eslint/no-unused-vars': [
                'error',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                    caughtErrorsIgnorePattern: '^_',
                },
            ],
            '@typescript-eslint/no-explicit-any': 'error',
            'no-console': 'off',
        },
    }
)
