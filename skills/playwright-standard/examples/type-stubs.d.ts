declare module '@playwright/test' {
    export const test: {
        extend<T>(config: any): any
    }
    export const expect: any
    export type Page = any
    export type Browser = any
    export type BrowserContext = any
    export type Locator = any
}
