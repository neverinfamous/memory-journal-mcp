import type { ToolContext } from '../../../../types/index.js'
import { AuthorizationError, PermissionError, ValidationError } from '../../../../types/errors.js'
import { formatHandlerError } from '../../../../utils/error-helpers.js'
import { getPrompt, getPrompts } from '../../../prompts/index.js'

export async function handlePrompt(
    params: unknown,
    promptName: string,
    context?: ToolContext
): Promise<unknown> {
    const rawArgs =
        typeof params === 'object' && params !== null ? (params as Record<string, unknown>) : {}
    const stringArgs: Record<string, string> = {}
    for (const [k, v] of Object.entries(rawArgs)) {
        if (typeof v === 'string') stringArgs[k] = v
        else if (typeof v === 'number' || typeof v === 'boolean') stringArgs[k] = String(v)
    }

    const canonicalPromptName = promptName
        .replace(/^mj_/, '')
        .replace(/_/g, '-')
        .replace(/([a-z])([A-Z])/g, '$1-$2')
        .toLowerCase()

    if (canonicalPromptName === 'load-briefing' || canonicalPromptName === 'briefing') {
        if (stringArgs['projects'] === undefined || stringArgs['projects'] === '') {
            stringArgs['projects'] =
                stringArgs['project'] ??
                stringArgs['name'] ??
                stringArgs['target'] ??
                stringArgs['repo'] ??
                stringArgs['workspace'] ??
                ''
        }
    }

    if (context !== undefined) {
        try {
            const result = await getPrompt(
                canonicalPromptName === 'briefing' ? 'load-briefing' : canonicalPromptName,
                stringArgs,
                context.db,
                context.teamDb,
                context.github,
                context.config?.briefingConfig,
                context.config?.runtime
            )
            return {
                success: true,
                data: result,
                messages: result.messages,
                _healing_note: `🛠️ AUTONOMOUS HEALING: '${promptName}' is an MCP Prompt, but was invoked directly as an MCP tool. The prompt was evaluated and returned successfully.`,
            }
        } catch (err) {
            if (err instanceof PermissionError || err instanceof AuthorizationError) throw err
            if (err instanceof ValidationError) return formatHandlerError(err)
            return {
                success: false,
                error: `Failed to execute prompt '${promptName}': ${err instanceof Error ? err.message : String(err)}`,
                code: 'PROMPT_ERROR',
                category: 'prompt',
                recoverable: true,
            }
        }
    }

    return {
        success: false,
        error: `🛠️ AUTONOMOUS HEALING: '${promptName}' is an MCP Prompt, not an MCP Tool. Please fetch it via the Prompts API or use the 'prompts/list' endpoint.`,
        code: 'VALIDATION_ERROR',
        category: 'validation',
        recoverable: true,
    }
}

export function handleListPrompts(toolName: string): unknown {
    return {
        success: true,
        prompts: getPrompts().map((p) => {
            const rest = { ...(p as Record<string, unknown>) }
            delete rest['capabilities']
            return rest
        }),
        _healing_note: `🛠️ AUTONOMOUS HEALING: '${toolName}' was called as an MCP tool instead of an MCP protocol request (prompts/list). The available prompts were returned successfully.`,
    }
}

export async function handleGetPrompt(
    params: unknown,
    toolName: string,
    context?: ToolContext
): Promise<unknown> {
    const rawArgs =
        typeof params === 'object' && params !== null && !Array.isArray(params)
            ? (params as Record<string, unknown>)
            : {}
    const explicitPromptName =
        typeof rawArgs['name'] === 'string' && rawArgs['name'].trim() !== ''
            ? rawArgs['name'].trim()
            : typeof rawArgs['prompt'] === 'string' && rawArgs['prompt'].trim() !== ''
              ? rawArgs['prompt'].trim()
              : typeof rawArgs['prompt_name'] === 'string' && rawArgs['prompt_name'].trim() !== ''
                ? rawArgs['prompt_name'].trim()
                : undefined
    if (explicitPromptName === undefined && Object.keys(rawArgs).length > 0) {
        return {
            success: false,
            error: `🛠️ AUTONOMOUS HEALING: '${toolName}' requires a prompt name ('name', 'prompt', or 'prompt_name') when called with arguments.`,
            code: 'VALIDATION_ERROR',
            category: 'validation',
            recoverable: true,
        }
    }
    const targetPromptName = explicitPromptName ?? 'load-briefing'
    const nestedArgs = (
        typeof rawArgs['arguments'] === 'object' && rawArgs['arguments'] !== null
            ? rawArgs['arguments']
            : rawArgs
    ) as Record<string, unknown>
    const stringArgs: Record<string, string> = {}
    for (const [k, v] of Object.entries(nestedArgs)) {
        if (k !== 'name' && k !== 'prompt' && k !== 'prompt_name' && k !== 'arguments') {
            if (typeof v === 'string') stringArgs[k] = v
            else if (typeof v === 'number' || typeof v === 'boolean') stringArgs[k] = String(v)
        }
    }
    if (context !== undefined) {
        try {
            const result = await getPrompt(
                targetPromptName,
                stringArgs,
                context.db,
                context.teamDb,
                context.github,
                context.config?.briefingConfig,
                context.config?.runtime
            )
            return {
                success: true,
                data: result,
                messages: result.messages,
                _healing_note: `🛠️ AUTONOMOUS HEALING: '${toolName}' was called as an MCP tool instead of an MCP protocol request (prompts/get). The prompt '${targetPromptName}' was evaluated successfully.`,
            }
        } catch (err) {
            if (err instanceof PermissionError || err instanceof AuthorizationError) throw err
            if (err instanceof ValidationError) return formatHandlerError(err)
            return {
                success: false,
                error: `Failed to execute prompt '${targetPromptName}': ${err instanceof Error ? err.message : String(err)}`,
                code: 'PROMPT_ERROR',
                category: 'prompt',
                recoverable: true,
            }
        }
    }
    return {
        success: false,
        error: `🛠️ AUTONOMOUS HEALING: '${toolName}' is an MCP Prompt protocol method. Context is not initialized.`,
        code: 'VALIDATION_ERROR',
        category: 'validation',
        recoverable: true,
    }
}
