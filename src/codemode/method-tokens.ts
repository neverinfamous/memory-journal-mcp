/**
 * Split a tool or method name into whole tokens.
 * `update_project` is `update` and `project`, not a match for `pr`.
 * `deleteAll` is `delete` and `all`, not a match for a list handler.
 */
const CAMEL_BOUNDARY_RE = /([a-z0-9])([A-Z])/g
const NON_ALNUM_RE = /[^A-Za-z0-9]+/g
const METHOD_TOKENS_CACHE = new Map<string, readonly string[]>()
const MAX_METHOD_TOKENS_CACHE = 512

/**
 * Split a tool or method name into whole tokens.
 * `update_project` is `update` and `project`, not a match for `pr`.
 * `deleteAll` is `delete` and `all`, not a match for a list handler.
 */
export function methodTokens(name: string): readonly string[] {
    const cached = METHOD_TOKENS_CACHE.get(name)
    if (cached !== undefined) return cached
    const spaced = name
        .replace(CAMEL_BOUNDARY_RE, '$1 $2')
        .replace(NON_ALNUM_RE, ' ')
        .toLowerCase()
    const rawParts = spaced.split(' ')
    const tokens: string[] = []
    for (const part of rawParts) {
        if (part.length > 0) tokens.push(part)
    }
    if (METHOD_TOKENS_CACHE.size < MAX_METHOD_TOKENS_CACHE) {
        METHOD_TOKENS_CACHE.set(name, tokens)
    }
    return tokens
}

export function hasMethodToken(name: string, token: string): boolean {
    return methodTokens(name).includes(token)
}
