/**
 * Package version constant injected at bundle time by tsup (`__MJ_PACKAGE_VERSION__`).
 * Avoids `createRequire` / `fs.readFileSync` inside Code Mode worker bundles.
 */
declare const __MJ_PACKAGE_VERSION__: string | undefined

export const PACKAGE_VERSION: string =
    typeof __MJ_PACKAGE_VERSION__ === 'string' && __MJ_PACKAGE_VERSION__ !== ''
        ? __MJ_PACKAGE_VERSION__
        : '9.1.0'
