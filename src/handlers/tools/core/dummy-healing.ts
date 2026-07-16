import { z } from 'zod'
import type { ToolDefinition } from '../../../types/index.js'

export function getDummyHealingTools(): ToolDefinition[] {
    return [
        {
            name: 'read_resource',
            title: 'DO NOT USE',
            description: 'DO NOT USE. 🛠️ AUTONOMOUS HEALING: This is a protocol-level MCP resource method, not an MCP tool. To read a file, use the native agent tool `read_file`, `read_resource` or the MCP tool `mj_execute_code`.',
            group: 'core',
            inputSchema: z.any(),
            outputSchema: z.any(),
            annotations: { readOnlyHint: true, openWorldHint: false },
            handler: () => {
                throw new Error(
                    '🛠️ AUTONOMOUS HEALING: `read_resource` is an MCP protocol method, not a tool. Use the native environment tool `read_resource` or `read_file`.'
                )
            },
        },
        {
            name: 'mj_read_resource',
            title: 'DO NOT USE',
            description: 'DO NOT USE. 🛠️ AUTONOMOUS HEALING: Use the native agent tool `read_resource` or `read_file`.',
            group: 'core',
            inputSchema: z.any(),
            outputSchema: z.any(),
            annotations: { readOnlyHint: true, openWorldHint: false },
            handler: () => {
                throw new Error(
                    '🛠️ AUTONOMOUS HEALING: `mj_read_resource` is not a valid tool. Use the native environment tool `read_resource` or `read_file`.'
                )
            },
        },
        {
            name: 'load-briefing',
            title: 'DO NOT USE',
            description: 'DO NOT USE. 🛠️ AUTONOMOUS HEALING: `load-briefing` is an MCP Prompt, not a Tool. Fetch it via the Prompts API.',
            group: 'core',
            inputSchema: z.any(),
            outputSchema: z.any(),
            annotations: { readOnlyHint: true, openWorldHint: false },
            handler: () => {
                throw new Error(
                    '🛠️ AUTONOMOUS HEALING: `load-briefing` is an MCP Prompt, not an MCP Tool. Please fetch it via the Prompts API or use the `prompts/list` endpoint.'
                )
            },
        },
        {
            name: 'mj_session_summary',
            title: 'DO NOT USE',
            description: 'DO NOT USE. 🛠️ AUTONOMOUS HEALING: `mj_session_summary` is an MCP Prompt, not a Tool. Fetch it via the Prompts API.',
            group: 'core',
            inputSchema: z.any(),
            outputSchema: z.any(),
            annotations: { readOnlyHint: true, openWorldHint: false },
            handler: () => {
                throw new Error(
                    '🛠️ AUTONOMOUS HEALING: `mj_session_summary` is an MCP Prompt, not an MCP Tool. Please fetch it via the Prompts API or use the `prompts/list` endpoint.'
                )
            },
        },
    ]
}
