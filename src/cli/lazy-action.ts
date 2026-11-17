/**
 * [INTENT] Defer heavyweight command handler imports until `.action(...)` executes
 * so `memory-journal-mcp --help` / `--version` avoid loading DB, vector, and MCP graphs.
 */
export function lazyAction<TArgs extends unknown[]>(
    loader: () => Promise<(...args: TArgs) => void | Promise<void>>
): (...args: TArgs) => Promise<void> {
    return async (...args: TArgs): Promise<void> => {
        const action = await loader()
        await action(...args)
    }
}
