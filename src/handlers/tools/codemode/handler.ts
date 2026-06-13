import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { logger } from '../../../utils/logger.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { getRequestContext, requestContextStorage } from '../../../utils/request-context.js'
import { runWithAuthContext, getAuthContext } from '../../../auth/auth-context.js'

import { getGitHubIntegration } from '../../../github/github-integration/index.js'
import { ConfigurationError } from '../../../types/errors.js'

import { ExecuteCodeSchema, ExecuteCodeSchemaMcp, VERSION_AWARE_TOOL_NAMES } from './schemas.js'
import { collectNonCodeModeTools, getSandboxPool, getSecurityManager } from './singleton-state.js'
import type { SandboxResult } from '../../../codemode/types.js'

export function getCodeModeTools(context: ToolContext): ToolDefinition[] {
    const securityManager = getSecurityManager()
    return [
        {
            name: 'mj_execute_code',
            title: 'Execute JS Code (Sandbox)',
            description:
                'Run arbitrary JavaScript to automate tasks. The code executes in a secure sandbox with access to all Memory Journal capabilities via the `mj` object. Use this for batch operations, cross-group workflows, complex filtering, or when standard tools require too many sequential MCP calls. Execution limit is 30s. IMPORTANT: Network access (`fetch`) is disabled. Anti-Hallucination Hint: Introspect groups (e.g. `Object.keys(mj.team)`) or inspect returned data structures (`return res[0]`) instead of guessing method names or property schemas. Example: `const res = await mj.searchEntries("test"); return res;`',
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
                    const executionCode = input.code || input.script

                    // 1. Configuration Validation
                    if (context.config?.codemodeEnabled !== true) {
                        throw new ConfigurationError('Code Mode is disabled in the server configuration.')
                    }

                    // 1a. Missing Payload Interceptor
                    if (!executionCode || executionCode.trim() === '') {
                        return {
                            success: false,
                            error: 'Missing required `code` parameter. This tool executes JavaScript in a secure sandbox.\n\nAvailable parameters:\n- code (string, required): The JavaScript code to execute\n- project_number (number, optional): The project ID to operate on\n- repo (string, optional): A GitHub repository to inject (e.g. "neverinfamous/adamic")\n- expected_version (string, optional): The expected journal version for optimistic concurrency\n- dry_run (boolean, optional): If true, simulates the execution without making changes\n\nTo discover available API methods and their schemas, read the `memory://help` resource, or invoke schema introspection directly in your script (e.g., `const schema = await mj.core.create_entry.schema()`).',
                            project_id: undefined,
                            executionTimeMs: 0
                        }
                    }

                    // 1b. Security Validation
                    const validation = securityManager.validateCode(executionCode)
                    if (!validation.valid) {
                        return {
                            success: false,
                            error: `Security validation failed: ${validation.errors.join(', ')}`,
                            project_id: undefined,
                            executionTimeMs: 0
                        }
                    }

                    // 1b. Rate Limiting
                    const clientId = context.auth?.sub ?? context.auth?.subject ?? 'default'
                    if (!securityManager.checkRateLimit(clientId)) {
                        return {
                            success: false,
                            error: 'Rate limit exceeded: Maximum code executions per minute reached.',
                            project_id: undefined,
                            executionTimeMs: 0
                        }
                    }

                    // 2. Project Injection Check
                    // If no explicit project is provided, check request context
                    let projectId = input.project_number
                    if (projectId === undefined || projectId === null) {
                        if (context.config?.defaultProjectNumber !== undefined) {
                            projectId = context.config.defaultProjectNumber
                        }
                    }

                    let sessionContext = context

                    // Context injection for GitHub / Kanban routing
                    const repo = input.repo
                    if (repo) {
                        if (!context.config?.codemodeInternalFullAccess) {
                            return {
                                success: false,
                                error: 'Repo switching is restricted to internal administrative access.',
                                project_id: undefined,
                                executionTimeMs: 0
                            }
                        }
                        if (context.config?.projectRegistry) {
                            let registryEntry = context.config.projectRegistry[repo]
                            if (!registryEntry && repo.includes('/')) {
                                const repoName = repo.split('/').pop()
                                if (repoName) {
                                    registryEntry = context.config.projectRegistry[repoName]
                                }
                            }

                            if (registryEntry) {
                                let injectedGithub
                                try {
                                    injectedGithub = getGitHubIntegration(
                                        registryEntry.path,
                                        undefined,
                                        process.env['GITHUB_TOKEN']
                                    )
                                    // Pre-populate cache so synchronous tools (like create_entry) can resolve Issue URLs
                                    await injectedGithub.getRepoInfo()
                                } catch (error) {
                                    return {
                                        success: false,
                                        error: `Failed to initialize injected repository '${repo}': ${error instanceof Error ? error.message : String(error)}`,
                                        project_id: undefined,
                                        executionTimeMs: 0
                                    }
                                }
                                sessionContext = {
                                    ...context,
                                    github: injectedGithub,
                                }
                            }
                        }
                    }

                    // Resolve string projectId at the outer level so:
                    // (a) auto-injection into tool calls always uses numeric values
                    // (b) the response project_id field is numeric
                    if (typeof projectId === 'string' && sessionContext.config?.projectRegistry) {
                        let entry = sessionContext.config.projectRegistry[projectId]
                        if (!entry && projectId.includes('/')) {
                            const repoName = projectId.split('/').pop()
                            if (repoName) {
                                entry = sessionContext.config.projectRegistry[repoName] ?? undefined
                            }
                        }
                        if (entry?.project_number !== undefined) {
                            projectId = entry.project_number
                        }
                    }
                    // Numeric string coercion for outer projectId: "14" -> 14
                    if (typeof projectId === 'string') {
                        const parsed = Number(projectId)
                        if (!Number.isNaN(parsed) && Number.isFinite(parsed)) {
                            projectId = parsed
                        }
                    }

                    // 2. Fetch all tools and cache them
                    let tools = collectNonCodeModeTools(sessionContext)

                    // 2b. Enforce Readonly Mode
                    // If the sandbox is explicitly requested as readonly, OR the server itself is in readonly mode
                    // and the user didn't explicitly override it with readonly: false, filter out mutating tools.
                    let isGlobalReadonly = false;
                    if (context.config?.filterConfig?.raw) {
                        const rawFilter = context.config.filterConfig.raw;
                        // Determine if server is explicitly configured with a readonly filter.
                        // We check for the 'readonly' meta-group explicitly, rather than checking if 
                        // create_entry is missing, because '--tool-filter codemode' strips create_entry 
                        // from the top-level but shouldn't inherently force codemode into readonly mode.
                        if (rawFilter.includes('readonly') && !rawFilter.includes('-readonly')) {
                            isGlobalReadonly = true;
                        }
                    }
                    const isSandboxReadonly = input.readonly ?? isGlobalReadonly;

                    if (isSandboxReadonly) {
                        tools = tools.filter((t) => t.annotations?.readOnlyHint === true)
                    }

                    // 3. Create the secure dispatcher wrapper around tool handlers
                    const secureDispatcher = async (
                        toolName: string,
                        toolParams: unknown,
                        isSimulation?: boolean
                    ): Promise<unknown> => {
                        const tool = tools.find((t) => t.name === toolName)
                        if (!tool) {
                            throw new Error(`[Security] Tool "${toolName}" is not available or registered in the environment. If you were trying to read a resource, use the proper readResource API instead.`)
                        }

                        let finalParams = toolParams

                        // Helper to deep convert camelCase to snake_case for top-level code mode payloads
                        const deepCamelToSnake = (obj: unknown): unknown => {
                            if (Array.isArray(obj)) return obj.map(deepCamelToSnake)
                            if (obj !== null && typeof obj === 'object') {
                                const newObj: Record<string, unknown> = {}
                                for (const [k, v] of Object.entries(obj)) {
                                    const snakeKey = k.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)
                                    newObj[snakeKey] = deepCamelToSnake(v)
                                }
                                return newObj
                            }
                            return obj
                        }
                        
                        // Apply deep camelCase normalization to prevent basic hallucinations (e.g. projectNumber -> project_number)
                        finalParams = deepCamelToSnake(finalParams)

                        // Inject and resolve project_number for ALL tools (not just team operations)
                        if (typeof finalParams === 'object' && finalParams !== null) {
                            const paramsObj = { ...(finalParams as Record<string, unknown>) }
                            
                            // Auto-inject project_number if not present but available from context
                            if (paramsObj['project_number'] === undefined && projectId !== undefined) {
                                paramsObj['project_number'] = projectId
                            }

                            // Auto-inject issue_url if issue_number is present and we have GitHub context
                            if (
                                paramsObj['issue_number'] !== undefined && 
                                paramsObj['issue_url'] === undefined && 
                                sessionContext.github
                            ) {
                                try {
                                    const repoInfo = await sessionContext.github.getRepoInfo()
                                    if (repoInfo?.owner && repoInfo?.repo) {
                                        paramsObj['issue_url'] = `https://github.com/${repoInfo.owner}/${repoInfo.repo}/issues/${String(Number(paramsObj['issue_number']))}`
                                    }
                                } catch {
                                    // Ignore errors and proceed without issue_url
                                }
                            }

                            // Auto-inject pr_url if pr_number is present and we have GitHub context
                            if (
                                paramsObj['pr_number'] !== undefined && 
                                paramsObj['pr_url'] === undefined && 
                                sessionContext.github
                            ) {
                                try {
                                    const repoInfo = await sessionContext.github.getRepoInfo()
                                    if (repoInfo?.owner && repoInfo?.repo) {
                                        paramsObj['pr_url'] = `https://github.com/${repoInfo.owner}/${repoInfo.repo}/pull/${String(Number(paramsObj['pr_number']))}`
                                    }
                                } catch {
                                    // Ignore errors and proceed without pr_url
                                }
                            }                          
                            
                            // Try string -> number resolution if registry is available
                            if (
                                typeof paramsObj['project_number'] === 'string' && 
                                sessionContext.config?.projectRegistry
                            ) {
                                // 1. Check if the string matches an explicit registry key -> numeric ID
                                const strVal = paramsObj['project_number']
                                const entry = sessionContext.config.projectRegistry[strVal]
                                if (entry?.project_number !== undefined) {
                                    paramsObj['project_number'] = entry.project_number
                                } else {
                                    // 2. Attempt 'owner/repo' splitting heuristic if no exact match
                                    if (strVal.includes('/')) {
                                        const repoName = strVal.split('/').pop()
                                        if (repoName) {
                                            const splitEntry = sessionContext.config.projectRegistry[repoName]
                                            if (splitEntry?.project_number !== undefined) {
                                                paramsObj['project_number'] = splitEntry.project_number
                                            }
                                        }
                                    }
                                }
                            }

                            // Numeric string coercion: "14" -> 14
                            if (typeof paramsObj['project_number'] === 'string') {
                                const parsed = Number(paramsObj['project_number'])
                                if (!Number.isNaN(parsed) && Number.isFinite(parsed)) {
                                    paramsObj['project_number'] = parsed
                                } else {
                                    return {
                                        success: false,
                                        error: `Invalid project_number: '${paramsObj['project_number']}'. Code Mode failed to resolve this to a known numeric ID. You can pass the exact numeric ID (e.g. 14), the repo name (e.g. 'mysql-mcp'), or simply OMIT the project_number field entirely to let the system auto-inject the current workspace's ID.`
                                    }
                                }
                            }

                            finalParams = paramsObj
                        }

                        // Expected Version Injection
                        if (
                            input.auto_version && 
                            VERSION_AWARE_TOOL_NAMES.has(toolName) &&
                            typeof finalParams === 'object' && 
                            finalParams !== null
                        ) {
                            const paramsObj = { ...(finalParams as Record<string, unknown>) }
                            // Only inject if they didn't explicitly provide it
                            if (paramsObj['expected_version'] === undefined && typeof paramsObj['entry_id'] === 'number') {
                                const existingEntry = sessionContext.teamDb?.getEntryById(paramsObj['entry_id'])
                                if (existingEntry?.version !== undefined) {
                                    paramsObj['expected_version'] = existingEntry.version
                                }
                            }
                            finalParams = paramsObj
                        }

                        // Mutation protection (after normalization so simulated responses show resolved params)
                        if (tool.annotations?.readOnlyHint === false && input.dry_run) {
                            return {
                                success: true,
                                dry_run: true,
                                message: `Simulated successful execution of ${toolName}`,
                                simulatedParams: finalParams,
                            }
                        }

                        // Optional Simulation Phase (e.g. for optimistic updates)
                        if (isSimulation && tool.annotations?.readOnlyHint === false) {
                            return {
                                success: true,
                                simulated: true,
                                params: finalParams,
                            }
                        }

                        // Execute the underlying handler directly
                        const result = await tool.handler(finalParams)
                        return result
                    }

                    // Prepare api bindings using the unified JournalApi factory
                    const { createJournalApi } = await import('../../../codemode/api/journal-api.js')
                    const journalApi = createJournalApi(tools, secureDispatcher)
                    const apiBindings = journalApi.createSandboxBindings(sessionContext.progress)
                    const schemas = journalApi.createSandboxSchemas()

                    // 4. Execute Code in Sandbox Worker
                    const pool = getSandboxPool()
                    
                    // Prepare sandbox payload
                    // If context was provided in the schema, use it. Otherwise empty object.
                    // We cast it to satisfy TypeScript since schemas.ts allows z.any() for flexibility
                    const userContext = (input.context as Record<string, unknown> | undefined) ?? {}
                    
                    // IMPORTANT: The worker relies on capturing the AuthContext from AsyncLocalStorage.
                    // We must run the execution wrapped in the current context so the worker thread
                    // can read the identical context values via getAuthContext().
                    // (Assuming our pool implementation forwards ALS correctly via node:worker_threads)
                    let execResult: SandboxResult | undefined
                    
                    // Re-wrap in auth and request context to ensure propagation into the pool
                    const authCtx = getAuthContext()
                    const reqCtx = getRequestContext()
                    
                    await requestContextStorage.run(reqCtx ?? {}, async () => {
                        if (authCtx) {
                            await runWithAuthContext(authCtx, async () => {
                                execResult = await pool.execute(
                                    executionCode ?? '',
                                    apiBindings,
                                    schemas,
                                    input.timeout ?? input.timeout_ms,
                                    userContext,
                                    input.dry_run
                                )
                            })
                        } else {
                            execResult = await pool.execute(
                                    executionCode ?? '',
                                    apiBindings,
                                    schemas,
                                    input.timeout ?? input.timeout_ms,
                                    userContext,
                                    input.dry_run
                            )
                        }
                    })
                    
                    const executionTime = performance.now() - start

                    // 5. Format and return results
                    return {
                        success: Boolean(execResult?.success),
                        executionTimeMs: Math.round(executionTime * 100) / 100,
                        result: execResult?.result,
                        error: execResult?.error,
                        metrics: execResult?.metrics,
                        simulated: input.dry_run ? true : undefined,
                        project_id: projectId,
                    }
                } catch (err) {
                    logger.error('CODEMODE_HANDLER_ERROR', { error: err })
                    return formatHandlerError(err)
                }
            },
        },
    ]
}
