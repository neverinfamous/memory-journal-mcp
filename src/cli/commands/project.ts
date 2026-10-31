import { type Command } from 'commander'
import * as path from 'node:path'
import * as os from 'node:os'
import * as fs from 'node:fs'

const configPath = path.resolve(os.homedir(), '.gemini', 'config', 'memory-journal.config.json')

import { DatabaseAdapterFactory } from '../../database/adapter-factory.js'
import { ConfigResolver } from '../../utils/config-resolver.js'
import { buildServerOptions } from '../server-options-builder.js'

function loadConfig(): Record<string, unknown> {
    if (!fs.existsSync(configPath)) {
        return { projectRegistry: {} }
    }
    try {
        const content = fs.readFileSync(configPath, 'utf-8')
        return JSON.parse(content) as Record<string, unknown>
    } catch (e) {
        process.stderr.write(`Error reading config file ${configPath}: ${String(e)}\n`)
        return { projectRegistry: {} }
    }
}

function saveConfig(config: Record<string, unknown>): void {
    fs.mkdirSync(path.dirname(configPath), { recursive: true })
    fs.writeFileSync(configPath, JSON.stringify(config, null, 4), 'utf-8')
}

export function projectListAction(options: Record<string, unknown>, _command: Command): void {
    const config = loadConfig()
    const registry = (config['projectRegistry'] ?? {}) as Record<string, { path: string, project_number?: number }>
    
    if (Object.keys(registry).length === 0) {
        process.stdout.write('No projects registered.\n')
        return
    }

    if (options['json'] === true) {
        process.stdout.write(JSON.stringify(registry, null, 2) + '\n')
        return
    }

    for (const [name, data] of Object.entries(registry)) {
        process.stdout.write(`${name}: ${data.path} (Project Number: ${data.project_number ?? 'None'})\n`)
    }
}

export async function projectCreateAction(name: string, options: Record<string, unknown>, command: Command): Promise<void> {
    if (!name || name.trim() === '') {
        process.stderr.write('Project name is required.\n')
        process.exit(1)
    }

    if (options['path'] == null) {
        process.stderr.write('Project path is required (--path).\n')
        process.exit(1)
    }

    const config = loadConfig()
    config['projectRegistry'] ??= {}

    const registry = config['projectRegistry'] as Record<string, { path: string, project_number?: number }>
    
    const absPath = path.resolve(process.cwd(), options['path'] as string)

    registry[name] = {
        path: absPath
    }

    if (options['number'] != null) {
        const num = parseInt(options['number'] as string, 10)
        if (isNaN(num)) {
            process.stderr.write('Invalid project number.\n')
            process.exit(1)
        }
        registry[name].project_number = num
    }

    saveConfig(config)

    process.stdout.write(`Project '${name}' successfully registered at ${absPath}.\n`)

    if (options['skipInit'] === true) {
        process.stdout.write(`\nSkipping automated database initialization (--skip-init).\n`)
        return
    }

    const projNum = options['number'] != null ? parseInt(options['number'] as string, 10) : 0
    
    // Perform database initialization natively
    let resolver: ConfigResolver
    const cliConfigPath = (options['config'] as string | undefined) ?? process.env['MEMORY_JOURNAL_CONFIG']
    try {
        resolver = new ConfigResolver(command, options, cliConfigPath)
    } catch {
        resolver = new ConfigResolver(command, {}, undefined)
    }

    const { serverOptions } = buildServerOptions(resolver, options, command, [])
    
    try {
        const db = await DatabaseAdapterFactory.create(serverOptions.dbPath, serverOptions)
        await db.initialize()
        
        db.createEntry({
            entryType: 'project_decision',
            significanceType: 'architecture',
            content: `Initialized project ${name}`,
            tags: ['project-initialization', 'setup'],
            projectNumber: projNum,
            trustScore: 1.0,
            impactScore: 0.5,
            validationStatus: 'passed'
        })
        
        db.close()
        process.stdout.write(`Database initialization entry successfully created.\n`)
    } catch (e) {
        process.stderr.write(`\nFailed to automatically initialize database entry: ${e instanceof Error ? e.message : String(e)}\n`)
        process.stderr.write(`You may need to run 'memory-journal-mcp entry create' manually.\n`)
    }
}

export function projectUpdateAction(name: string, options: Record<string, unknown>, _command: Command): void {
    if (!name || name.trim() === '') {
        process.stderr.write('Project name is required.\n')
        process.exit(1)
    }

    const config = loadConfig()
    const registry = (config['projectRegistry'] ?? {}) as Record<string, { path: string, project_number?: number }>

    if (!registry[name]) {
        process.stderr.write(`🛠️ AUTONOMOUS HEALING: Project '${name}' not found.\n`)
        process.exit(1)
    }

    const project = registry[name] ?? { path: '' }
    let modified = false

    if (options['path'] != null) {
        project.path = path.resolve(process.cwd(), options['path'] as string)
        modified = true
    }

    if (options['number'] != null) {
        const num = parseInt(options['number'] as string, 10)
        if (!isNaN(num)) {
            project.project_number = num
            modified = true
        }
    }

    const targetName = (options['rename'] as string | undefined) ?? name
    if (targetName !== name) {
        modified = true
    }

    if (!modified) {
        process.stdout.write('No updates specified.\n')
        return
    }

    const rest = Object.fromEntries(Object.entries(registry).filter(([key]) => key !== name))
    const newRegistry = { ...rest, [targetName]: project }
    config['projectRegistry'] = newRegistry
    saveConfig(config)

    process.stdout.write(`Project '${targetName}' successfully updated.\n`)
}

export function projectDeleteAction(name: string, _options: Record<string, unknown>, _command: Command): void {
    if (!name || name.trim() === '') {
        process.stderr.write('Project name is required.\n')
        process.exit(1)
    }

    const config = loadConfig()
    const registry = (config['projectRegistry'] ?? {}) as Record<string, { path: string, project_number?: number }>

    if (!registry[name]) {
        process.stderr.write(`🛠️ AUTONOMOUS HEALING: Project '${name}' not found.\n`)
        process.exit(1)
    }

    const rest = Object.fromEntries(Object.entries(registry).filter(([key]) => key !== name))
    config['projectRegistry'] = rest
    saveConfig(config)

    process.stdout.write(`Project '${name}' successfully deleted.\n`)
}

