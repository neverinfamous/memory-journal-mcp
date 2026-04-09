// Type stubs for the Vitest Standard skill examples.
// This file solves "Cannot find module" errors in the IDE when viewing
// master reference files outside of a project root.

declare module 'vitest' {
    export const describe: any
    export const it: any
    export const expect: any
    export const vi: any
    export const beforeEach: any
    export const afterEach: any
    export const beforeAll: any
    export const afterAll: any
}

declare module 'vitest/config' {
    export const defineConfig: any
}
