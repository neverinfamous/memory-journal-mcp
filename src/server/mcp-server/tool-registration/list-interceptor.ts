import type { ConfigManager } from '../../../utils/config-manager.js'

export type RequestHandlerMap = Map<string, (req: unknown, ext: unknown) => Promise<unknown>>

export function attachListToolsInterceptor(
    requestHandlers: RequestHandlerMap | undefined,
    configManager: ConfigManager,
    allToolNames: Set<string>
): void {
    const listToolsHandler = requestHandlers?.get('tools/list')
    if (listToolsHandler === undefined || requestHandlers === undefined) {
        return
    }

    requestHandlers.set('tools/list', async (request: unknown, extra: unknown) => {
        const currentConfig = configManager.getConfig()
        const enabledSet = currentConfig.toolFilterConfig?.enabledTools ?? allToolNames

        const result = await listToolsHandler(request, extra)
        const res = result as { tools?: { name: string }[] } | undefined
        if (Array.isArray(res?.tools)) {
            res.tools = res.tools.filter((t) => enabledSet.has(t.name))
        }
        return result
    })
}
