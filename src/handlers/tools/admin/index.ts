import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { getCoreTools } from './core-tools.js'
import { getBatchTools } from './batch-tools.js'
import { getVectorTools } from './vector-tools.js'
import { getMiscTools } from './misc-tools.js'
import { getLifecycleTools } from './lifecycle-tools.js'
import { getProjectTools } from './project-tools.js'
import {
    updateConfigurationSchema,
    updateConfigurationSchemaMcp,
    handleUpdateConfiguration,
} from './update_configuration.js'
import { ErrorFieldsMixin } from '../error-fields-mixin.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { z } from 'zod'

export function getAdminTools(context: ToolContext): ToolDefinition[] {
    return [
        ...getCoreTools(context),
        ...getBatchTools(context),
        ...getVectorTools(context),
        ...getMiscTools(context),
        ...getLifecycleTools(context),
        ...getProjectTools(context),
        {
            name: 'update_configuration',
            title: 'Update Server Configuration',
            description: 'Dynamically update the MCP server configuration (tool filters, briefing preferences, and default workspace/project scope) without restarting the server.',
            group: 'admin',
            inputSchema: updateConfigurationSchemaMcp,
            outputSchema: z
                .object({
                    success: z.boolean().optional(),
                    updated: z.array(z.string()).optional(),
                    // [INTENT] M5: surface non-fatal persistence warnings instead of stripping them.
                    warning: z.string().optional(),
                    persisted: z.boolean().optional(),
                    partial: z.boolean().optional(),
                    error: z.string().optional(),
                })
                .extend(ErrorFieldsMixin.shape),
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
            handler: async (params: unknown) => {
                if (!context.config) {
                     return { success: false, updated: [], error: 'Configuration context missing' }
                }
                try {
                    const parsed = updateConfigurationSchema.parse(params)
                    return await handleUpdateConfiguration(parsed, context.config)
                } catch (err) {
                    return formatHandlerError(err)
                }
            }
        }
    ];
}
