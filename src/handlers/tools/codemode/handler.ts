import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { getRequestContext, requestContextStorage } from '../../../utils/request-context.js'
import { runWithAuthContext } from '../../../auth/auth-context.js'

import { ExecuteCodeSchema, ExecuteCodeSchemaMcp, MUTATION_TOOL_NAMES, VERSION_AWARE_TOOL_NAMES } from './schemas.js'
import { collectNonCodeModeTools, getSandboxPool, getSecurityManager } from './singleton-state.js'

export function getCodeModeTools(context: ToolContext): ToolDefinition[] {
    return [
        {
            name: 'mj_execute_code',
            title: 'Execute JS Code (Sandbox)',
            description:
                'Run arbitrary JavaScript to automate tasks. The code executes in a secure sandbox with access to all Memory Journal capabilities via the `mj` object. Use this for batch operations, cross-group workflows, complex filtering, or when standard tools require too many sequential MCP calls. Execution limit is 30s. IMPORTANT: Network access (`fetch`) is disabled. Example: `const res = await mj.searchEntries("test"); return res;`',
            group: 'codemode',
            inputSchema: ExecuteCodeSchemaMcp,
            outputSchema: undefined,
            annotations: {
                readOnlyHint: false, // Execution can be destructive
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: true,
            },
            handler: async (params: unknown) => {
                const start = performance.now()
                
                try {
                    const input = ExecuteCodeSchema.parse(params)

                    // 1. Project Injection Check
                    // If no explicit project is provided, check request context
                    let projectId = input.project_number
                    if (projectId === undefined || projectId === null) {
                        const requestCtx = getRequestContext()
                        if (requestCtx?.projectId !== undefined) {
                            projectId = requestCtx.projectId
                        }
                    }

                    // 2. Fetch all tools and cache them
                    const tools = collectNonCodeModeTools(context)
                    const securityManager = getSecurityManager(context)

                    // 3. Create the secure dispatcher wrapper around tool handlers
                    const secureDispatcher = async (
                        toolName: string,
                        toolParams: unknown,
                        isSimulation?: boolean
                    ) => {
                        const tool = tools.find((t) => t.name === toolName)
                        if (!tool) {
                            throw new Error(`[Security] Tool "${toolName}" is not available or registered in the environment. If you were trying to read a resource, use the proper readResource API instead.`)
                        }

                        // Validate against security rules
                        const validation = securityManager.validateToolAccess(toolName, toolParams)
                        if (!validation.allowed) {
                            throw new Error(`[Security] Access denied: ${validation.reason}`)
                        }

                        // Mutation protection
                        if (MUTATION_TOOL_NAMES.has(toolName) && input.dry_run) {
                            return {
                                success: true,
                                dry_run: true,
                                message: `Simulated successful execution of ${toolName}`,
                                simulatedParams: validation.sanitizedParams,
                            }
                        }

                        // Optional Simulation Phase (e.g. for optimistic updates)
                        if (isSimulation && MUTATION_TOOL_NAMES.has(toolName)) {
                            return {
                                success: true,
                                simulated: true,
                                params: validation.sanitizedParams,
                            }
                        }

                        // Inject project_number for team operations
                        if (
                            toolName.startsWith('team_') ||
                            toolName === 'cross_team_search' ||
                            toolName === 'create_relationship'
                        ) {
                            if (typeof validation.sanitizedParams === 'object' && validation.sanitizedParams !== null) {
                                const paramsObj = validation.sanitizedParams as Record<string, unknown>
                                
                                // Auto-inject project_number if not present but available from context
                                if (paramsObj.project_number === undefined && projectId !== undefined) {
                                    paramsObj.project_number = projectId
                                }
                                
                                // Try string -> number resolution if registry is available
                                if (
                                    typeof paramsObj.project_number === 'string' && 
                                    context.config?.projectRegistry
                                ) {
                                    // 1. Check if the string matches an explicit ID -> numeric ID resolution
                                    const projects = context.config.projectRegistry.projects || []
                                    const match = projects.find(p => p.id === paramsObj.project_number)
                                    
                                    if (match) {
                                        paramsObj.project_number = match.id
                                    } else {
                                        // 2. Attempt 'owner/repo' splitting heuristic if no exact match
                                        const strVal = String(paramsObj.project_number)
                                        if (strVal.includes('/')) {
                                            const parts = strVal.split('/')
                                            if (parts.length === 2 && typeof parts[1] === 'string') {
                                                // Temporarily replace with the repo portion and see if the team mutation
                                                // handler's internal fuzzy-matching can resolve it.
                                                // Note: this is a weak fallback because project_number is expected to be a number.
                                                // In future versions, the registry should strictly enforce number IDs.
                                                // We assign the string here knowing Zod might fail it, but 'relaxedNumber' allows it
                                                // to pass to the handler which will do a fuzzy string match.
                                                paramsObj.project_number = parts[1]
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        // Expected Version Injection
                        if (
                            input.auto_version && 
                            VERSION_AWARE_TOOL_NAMES.has(toolName) &&
                            typeof validation.sanitizedParams === 'object' && 
                            validation.sanitizedParams !== null
                        ) {
                            const paramsObj = validation.sanitizedParams as Record<string, unknown>
                            // Only inject if they didn't explicitly provide it
                            if (paramsObj.expected_version === undefined && typeof paramsObj.entry_id === 'number') {
                                const existingEntry = context.teamDb?.getEntryById(paramsObj.entry_id)
                                if (existingEntry?.version !== undefined) {
                                    paramsObj.expected_version = existingEntry.version
                                }
                            }
                        }

                        // Execute the underlying handler directly
                        const result = await tool.handler(validation.sanitizedParams)
                        return result
                    }

                    // 4. Execute Code in Sandbox Worker
                    const pool = getSandboxPool()
                    
                    // Prepare sandbox payload
                    // If context was provided in the schema, use it. Otherwise empty object.
                    const userContext = input.context ?? {}
                    
                    // IMPORTANT: The worker relies on capturing the AuthContext from AsyncLocalStorage.
                    // We must run the execution wrapped in the current context so the worker thread
                    // can read the identical context values via getAuthContext().
                    // (Assuming our pool implementation forwards ALS correctly via node:worker_threads)
                    let execResult;
                    
                    // Re-wrap in auth and request context to ensure propagation into the pool
                    const authCtx = getAuthContext()
                    const reqCtx = getRequestContext()
                    
                    await requestContextStorage.run(reqCtx ?? {}, async () => {
                        if (authCtx) {
                            await runWithAuthContext(authCtx, async () => {
                                execResult = await pool.executeWithDispatcher(
                                    input.code ?? '',
                                    secureDispatcher,
                                    userContext
                                )
                            })
                        } else {
                            execResult = await pool.executeWithDispatcher(
                                input.code ?? '',
                                secureDispatcher,
                                userContext
                            )
                        }
                    })
                    
                    const executionTime = performance.now() - start

                    // 5. Format and return results
                    return {
                        success: execResult!.success,
                        executionTimeMs: Math.round(executionTime * 100) / 100,
                        result: execResult!.result,
                        error: execResult!.error,
                        logs: execResult!.logs,
                        simulated: input.dry_run ? true : undefined,
                        project_id: projectId,
                    }
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
    ]
}
