/**
 * Split a tool or method name into whole tokens.
 * `update_project` is `update` and `project`, not a match for `pr`.
 * `deleteAll` is `delete` and `all`, not a match for a list handler.
 */
export function methodTokens(name: string): string[] {
    const spaced = name
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[^A-Za-z0-9]+/g, ' ')
        .toLowerCase()
    return spaced.split(' ').filter((part) => part.length > 0)
}

export function hasMethodToken(name: string, token: string): boolean {
    return methodTokens(name).includes(token)
}
