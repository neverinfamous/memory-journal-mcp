import { z } from 'zod'
import type { ErrorResponse } from '../../../types/error-types.js'
import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { sendProgress } from '../../../utils/progress-utils.js'
import { MemoryJournalMcpError } from '../../../types/errors.js'
import { TestSimpleSchema, TestSimpleOutputSchema } from './schemas.js'
import { ErrorFieldsMixin } from '../error-fields-mixin.js'

/** Delay between steps of the `trigger_progress` demo tool. */
const PROGRESS_DEMO_STEP_DELAY_MS = 500

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

async function executeTriggerProgress(
    params: unknown,
    context: ToolContext
): Promise<Record<string, unknown> | ErrorResponse> {
    try {
        z.object({}).strict().parse(params ?? {})
        const progress = context.progress
        await sendProgress(progress, 0, 3, 'Starting operation...')
        await sleep(PROGRESS_DEMO_STEP_DELAY_MS)
        await sendProgress(progress, 1, 3, 'Processing step 1...')
        await sleep(PROGRESS_DEMO_STEP_DELAY_MS)
        await sendProgress(progress, 2, 3, 'Processing step 2...')
        await sleep(PROGRESS_DEMO_STEP_DELAY_MS)
        await sendProgress(progress, 3, 3, 'Operation complete')
        return {
            success: true,
            message: 'Progress notifications completed successfully',
        }
    } catch (err) {
        return formatHandlerError(err)
    }
}

function executeTestErrorHandling(params: unknown): Record<string, unknown> | ErrorResponse {
    try {
        const input = z
            .object({
                error_type: z.enum(['zod', 'type', 'database', 'generic', 'memory_journal']),
                message: z.string().optional().default('Test error message'),
            })
            .parse(params)

        if (input.error_type === 'database') {
            const err = new Error(`SQLITE_CONSTRAINT: ${input.message}`)
            Object.defineProperty(err, 'code', {
                value: 'SQLITE_CONSTRAINT',
                enumerable: true,
            })
            throw err
        }

        if (input.error_type === 'type') {
            throw new TypeError(input.message)
        }

        if (input.error_type === 'memory_journal') {
            throw new MemoryJournalMcpError(input.message, 'TEST_ERROR', 'internal')
        }

        if (input.error_type === 'zod') {
            z.object({ required_field: z.string() }).parse({})
        }

        throw new Error(input.message)
    } catch (err) {
        return formatHandlerError(err)
    }
}

/**
 * [BOUNDARY] Diagnostic and transport-verification tools (`test_simple`, `trigger_progress`,
 * `test_error_handling`) split from `core/tools.ts` to keep modules well below 500 lines.
 */
export function getDiagnosticTools(context: ToolContext): ToolDefinition[] {
    return [
        {
            name: 'test_simple',
            title: 'Test Simple Echo',
            description: 'A simple echo tool for testing connection and basic parameter parsing.',
            group: 'core',
            inputSchema: TestSimpleSchema,
            outputSchema: TestSimpleOutputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: (params: unknown) => {
                try {
                    const input = TestSimpleSchema.parse(params)
                    return {
                        success: true,
                        message: `Echo: ${input.message}`,
                        timestamp: new Date().toISOString(),
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'trigger_progress',
            title: 'Test Progress Notifications',
            description:
                'Triggers a sequence of progress notifications to verify the transport layer supports them.',
            group: 'core',
            inputSchema: z.object({}).strict(),
            outputSchema: z
                .object({ success: z.boolean().optional(), message: z.string().optional() })
                .extend(ErrorFieldsMixin.shape),
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: (params: unknown) => executeTriggerProgress(params, context),
        },
        {
            name: 'test_error_handling',
            title: 'Test Error Handling',
            description:
                'Throws a specific type of error to verify the server formats and returns them correctly over MCP.',
            group: 'core',
            inputSchema: z.object({
                error_type: z.enum(['zod', 'type', 'database', 'generic', 'memory_journal']),
                message: z.string().optional().default('Test error message'),
            }),
            outputSchema: z.object({}).extend(ErrorFieldsMixin.shape),
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: (params: unknown) => executeTestErrorHandling(params),
        },
    ]
}
