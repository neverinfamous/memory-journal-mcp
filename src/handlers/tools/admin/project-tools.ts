import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import {
    RegisterProjectSchemaMcp,
    UpdateProjectSchemaMcp,
    DeleteProjectSchemaMcp,
    GetProjectSchemaMcp,
    ListProjectsSchemaMcp,
    ProjectOutputSchema
} from './schemas.js'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

function getRegistryConfigPath(): string {
    return process.env['MEMORY_JOURNAL_CONFIG'] ?? path.resolve(os.homedir(), '.gemini', 'config', 'memory-journal.config.json')
}

function loadConfig(): Record<string, unknown> {
    const configPath = getRegistryConfigPath()
    if (fs.existsSync(configPath)) {
        try {
            return JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>
        } catch {
            return { projectRegistry: {} }
        }
    }
    return { projectRegistry: {} }
}

function saveConfig(config: Record<string, unknown>): void {
    const configPath = getRegistryConfigPath()
    fs.mkdirSync(path.dirname(configPath), { recursive: true })
    fs.writeFileSync(configPath, JSON.stringify(config, null, 4), 'utf-8')
    process.env['PROJECT_REGISTRY'] = JSON.stringify(config['projectRegistry'])
}

export function getProjectTools(_context: ToolContext): ToolDefinition[] {
    return [
        {
            name: 'register_project',
            title: 'Register Project',
            description: 'Register a new project in the global registry. This is required before the agent can switch context to this repository.',
            group: 'admin',
            inputSchema: RegisterProjectSchemaMcp,
            outputSchema: ProjectOutputSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: (params: unknown) => {
                try {
                    const parsed = RegisterProjectSchemaMcp.parse(params)
                    const config = loadConfig()
                    config['projectRegistry'] ??= {}
                    const registry = config['projectRegistry'] as Record<string, { path: string, project_number?: number }>
                    
                    const projectRef = registry[parsed.name] ?? { path: parsed.absolute_path }
                    projectRef.path = parsed.absolute_path
                    if (typeof parsed.project_number === 'number' && !Number.isNaN(parsed.project_number)) {
                        projectRef.project_number = parsed.project_number
                    }
                    registry[parsed.name] = projectRef
                    
                    saveConfig(config)
                    
                    const message = `Project '${parsed.name}' registered successfully.`
                    return Promise.resolve({ success: true, message, project: { name: parsed.name, ...registry[parsed.name] } })
                } catch (err) {
                    return Promise.resolve(formatHandlerError(err))
                }
            }
        },
        {
            name: 'update_project',
            title: 'Update Project',
            description: 'Update the details (path, number, or name) of an existing project in the registry.',
            group: 'admin',
            inputSchema: UpdateProjectSchemaMcp,
            outputSchema: ProjectOutputSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
            handler: (params: unknown) => {
                try {
                    const parsed = UpdateProjectSchemaMcp.parse(params)
                    const config = loadConfig()
                    config['projectRegistry'] ??= {}
                    const registry = config['projectRegistry'] as Record<string, { path: string, project_number?: number }>
                    
                    if (!registry[parsed.name]) {
                        return { success: false, error: `🛠️ AUTONOMOUS HEALING: Project not found: '${parsed.name}'` }
                    }
                    
                    const project = registry[parsed.name] ?? { path: '' }
                    
                    if (parsed.absolute_path) {
                        project.path = parsed.absolute_path
                    }
                    if (typeof parsed.project_number === 'number' && !Number.isNaN(parsed.project_number)) {
                        project.project_number = parsed.project_number
                    }
                    
                    const targetName = parsed.new_name ?? parsed.name
                    if (parsed.new_name && parsed.new_name !== parsed.name) {
                        const { [parsed.name]: removed, ...rest } = registry
                        void removed
                        config['projectRegistry'] = rest
                    }
                    
                    const updatedRegistry = config['projectRegistry'] as Record<string, { path: string, project_number?: number }>
                    updatedRegistry[targetName] = project
                    saveConfig(config)
                    
                    return Promise.resolve({ success: true, message: `Project '${targetName}' updated.`, project: { name: targetName, ...updatedRegistry[targetName] } })
                } catch (err) {
                    return Promise.resolve(formatHandlerError(err))
                }
            }
        },
        {
            name: 'delete_project',
            title: 'Delete Project',
            description: 'Remove a project from the global registry.',
            group: 'admin',
            inputSchema: DeleteProjectSchemaMcp,
            outputSchema: ProjectOutputSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: true,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: (params: unknown) => {
                try {
                    const parsed = DeleteProjectSchemaMcp.parse(params)
                    const config = loadConfig()
                    config['projectRegistry'] ??= {}
                    const registry = config['projectRegistry'] as Record<string, { path: string, project_number?: number }>
                    
                    if (!registry[parsed.name]) {
                        return Promise.resolve({ success: false, error: `🛠️ AUTONOMOUS HEALING: Project not found: '${parsed.name}'` })
                    }
                    
                    const { [parsed.name]: removed, ...rest } = registry
                    void removed
                    config['projectRegistry'] = rest
                    saveConfig(config)
                    
                    return Promise.resolve({ success: true, message: `Project '${parsed.name}' deleted.` })
                } catch (err) {
                    return Promise.resolve(formatHandlerError(err))
                }
            }
        },
        {
            name: 'list_projects',
            title: 'List Projects',
            description: 'List all registered projects.',
            group: 'admin',
            inputSchema: ListProjectsSchemaMcp,
            outputSchema: ProjectOutputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: () => {
                try {
                    const config = loadConfig()
                    config['projectRegistry'] ??= {}
                    const registry = config['projectRegistry'] as Record<string, { path: string, project_number?: number }>
                    
                    return Promise.resolve({ success: true, projects: registry })
                } catch (err) {
                    return Promise.resolve(formatHandlerError(err))
                }
            }
        },
        {
            name: 'get_project',
            title: 'Get Project',
            description: 'Get details of a specific registered project.',
            group: 'admin',
            inputSchema: GetProjectSchemaMcp,
            outputSchema: ProjectOutputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: (params: unknown) => {
                try {
                    const parsed = GetProjectSchemaMcp.parse(params)
                    const config = loadConfig()
                    config['projectRegistry'] ??= {}
                    const registry = config['projectRegistry'] as Record<string, { path: string, project_number?: number, id?: number }>
                    
                    let foundName = parsed.name
                    let projectInfo = registry[foundName]
                    const rawProjNum = (parsed as Record<string, unknown>)['project_number']
                    const parsedProjNum = typeof rawProjNum === 'number' ? rawProjNum : undefined
                    if (!projectInfo && (!isNaN(Number(parsed.name)) || parsedProjNum !== undefined)) {
                        const targetNum = parsedProjNum ?? Number(parsed.name)
                        for (const [pName, pData] of Object.entries(registry)) {
                            if (pData.project_number === targetNum || pData.id === targetNum) {
                                foundName = pName
                                projectInfo = pData
                                break
                            }
                        }
                    }

                    if (!projectInfo) {
                        return Promise.resolve({ success: false, error: `🛠️ AUTONOMOUS HEALING: Project not found: '${parsed.name}'` })
                    }
                    
                    return Promise.resolve({
                        success: true,
                        project: {
                            name: foundName,
                            id: projectInfo.project_number ?? projectInfo.id,
                            ...projectInfo
                        }
                    })
                } catch (err) {
                    return Promise.resolve(formatHandlerError(err))
                }
            }
        }
    ]
}
