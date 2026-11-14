import { type Command } from 'commander'
import * as path from 'node:path'
import * as os from 'node:os'
import * as fs from 'node:fs'

const configPath = path.resolve(os.homedir(), '.gemini', 'config', 'memory-journal.config.json')

import { DatabaseAdapterFactory } from '../../database/adapter-factory.js'
import { ConfigResolver } from '../../utils/config-resolver.js'
import { readProjectRegistryFile } from '../../utils/registry-config-file.js'
import { buildServerOptions } from '../server-options-builder.js'
import { dumpConfigAndExit } from '../dump-config.js'

function handleProjectDumpConfig(options: Record<string, unknown>, command: Command): void {
    if (options['dumpConfig'] !== true) return
    let resolver: ConfigResolver
    const cliConfigPath = (options['config'] as string | undefined) ?? process.env['MEMORY_JOURNAL_CONFIG']
    const configErrors: string[] = []
    try {
        resolver = new ConfigResolver(command, options, cliConfigPath)
    } catch (err) {
        configErrors.push(err instanceof Error ? err.message : String(err))
        resolver = new ConfigResolver(command, {}, undefined)
    }
    const { serverOptions } = buildServerOptions(resolver, options, command, configErrors)
    if (configErrors.length > 0) {
        process.stderr.write('Startup Configuration Errors:\n')
        configErrors.forEach((err) => process.stderr.write(` - ${err}\n`))
        process.exit(1)
    }
    dumpConfigAndExit(serverOptions)
}

function getConfigPath(options?: Record<string, unknown>): string {
    const custom = (options?.['config'] as string | undefined) ?? process.env['MEMORY_JOURNAL_CONFIG']
    return custom ? path.resolve(custom) : configPath
}

function loadConfig(options?: Record<string, unknown>): Record<string, unknown> {
    return readProjectRegistryFile(getConfigPath(options)).config
}

function saveConfig(config: Record<string, unknown>, options?: Record<string, unknown>): void {
    const targetPath = getConfigPath(options)
    fs.mkdirSync(path.dirname(targetPath), { recursive: true })
    fs.writeFileSync(targetPath, JSON.stringify(config, null, 4), 'utf-8')
}

function parsePositiveCliProjectNumber(raw: unknown): number {
    const trimmed = String(raw).trim()
    const num = /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN
    if (!Number.isInteger(num) || num < 1) {
        process.stderr.write('Invalid project number.\n')
        process.exit(1)
    }
    return num
}

export function projectListAction(options: Record<string, unknown>, command: Command): void {
    handleProjectDumpConfig(options, command)
    const config = loadConfig(options)
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
    handleProjectDumpConfig(options, command)
    if (!name || name.trim() === '') {
        process.stderr.write('Project name is required.\n')
        process.exit(1)
    }

    if (options['path'] == null) {
        process.stderr.write('Project path is required (--path).\n')
        process.exit(1)
    }

    const config = loadConfig(options)
    config['projectRegistry'] ??= {}

    const registry = config['projectRegistry'] as Record<string, { path: string, project_number?: number }>
    
    const absPath = path.resolve(process.cwd(), options['path'] as string)

    registry[name] = {
        path: absPath
    }

    if (options['number'] != null) {
        registry[name].project_number = parsePositiveCliProjectNumber(options['number'])
    }

    saveConfig(config, options)

    const isJson = options['json'] === true
    if (!isJson) {
        process.stdout.write(`Project '${name}' successfully registered at ${absPath}.\n`)
    }

    if (options['skipInit'] === true) {
        if (isJson) {
            process.stdout.write(
                JSON.stringify({ status: 'success', name, path: absPath, initialized: false }) +
                    '\n'
            )
        } else {
            process.stdout.write(`\nSkipping automated database initialization (--skip-init).\n`)
        }
        return
    }

    // Reuse the already-validated project number (NaN was rejected above)
    const projNum = registry[name].project_number

    // Perform database initialization natively
    let resolver: ConfigResolver
    const cliConfigPath = (options['config'] as string | undefined) ?? process.env['MEMORY_JOURNAL_CONFIG']
    try {
        resolver = new ConfigResolver(command, options, cliConfigPath)
    } catch (e) {
        process.stderr.write(
            `\nInvalid configuration, skipping database initialization: ${e instanceof Error ? e.message : String(e)}\n`
        )
        process.stderr.write(
            `Fix the configuration and run 'memory-journal-mcp entry create' manually.\n`
        )
        process.exitCode = 1
        return
    }

    const configErrors: string[] = []
    const { serverOptions } = buildServerOptions(resolver, options, command, configErrors)
    if (configErrors.length > 0) {
        // [INVARIANT] Never initialize a database from a configuration that failed validation (H13).
        process.stderr.write('\nInvalid configuration, skipping database initialization:\n')
        configErrors.forEach((err) => process.stderr.write(` - ${err}\n`))
        process.exitCode = 1
        return
    }
    const effectiveProjNum = projNum

    if (effectiveProjNum === undefined) {
        if (isJson) {
            process.stdout.write(
                JSON.stringify({ status: 'success', name, path: absPath, initialized: false }) +
                    '\n'
            )
        } else {
            process.stdout.write(
                `\nSkipping automated database initialization because no project number was specified (use --number <n> to create an initialization entry).\n`
            )
        }
        return
    }

    try {
        const db = await DatabaseAdapterFactory.create(serverOptions.dbPath, serverOptions)
        await db.initialize()

        const created = db.createEntry({
            entryType: 'project_decision',
            significanceType: 'architecture',
            content: `Initialized project ${name}`,
            tags: ['project-initialization', 'setup'],
            workspaceId: name,
            projectNumber: effectiveProjNum,
            trustScore: 1.0,
            impactScore: 0.5,
            validationStatus: 'passed',
        })

        db.flushSave()
        db.close()
        if (isJson) {
            process.stdout.write(
                JSON.stringify({
                    status: 'success',
                    name,
                    path: absPath,
                    project_number: effectiveProjNum,
                    initialized: true,
                    entry_id: created.id,
                }) + '\n'
            )
        } else {
            process.stdout.write(`Database initialization entry successfully created.\n`)
        }
    } catch (e) {
        process.stderr.write(`\nFailed to automatically initialize database entry: ${e instanceof Error ? e.message : String(e)}\n`)
        process.stderr.write(`You may need to run 'memory-journal-mcp entry create' manually.\n`)
        process.exitCode = 1
    }
}

export function projectUpdateAction(name: string, options: Record<string, unknown>, command: Command): void {
    handleProjectDumpConfig(options, command)
    if (!name || name.trim() === '') {
        process.stderr.write('Project name is required.\n')
        process.exit(1)
    }

    const config = loadConfig(options)
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
        project.project_number = parsePositiveCliProjectNumber(options['number'])
        modified = true
    }

    const targetName = (options['rename'] as string | undefined)?.trim() ?? name
    if (targetName === '') {
        process.stderr.write('--rename requires a non-empty project name.\n')
        process.exit(1)
    }
    if (targetName !== name) {
        // [INVARIANT] Renaming must never silently overwrite another registered project (H13).
        if (Object.prototype.hasOwnProperty.call(registry, targetName)) {
            process.stderr.write(`Project '${targetName}' already exists; refusing to overwrite it.\n`)
            process.exit(1)
        }
        modified = true
    }

    if (!modified) {
        process.stdout.write('No updates specified.\n')
        return
    }

    const rest = Object.fromEntries(Object.entries(registry).filter(([key]) => key !== name))
    const newRegistry = { ...rest, [targetName]: project }
    config['projectRegistry'] = newRegistry
    saveConfig(config, options)

    process.stdout.write(`Project '${targetName}' successfully updated.\n`)
}

export function projectDeleteAction(name: string, options: Record<string, unknown>, command: Command): void {
    handleProjectDumpConfig(options, command)
    if (!name || name.trim() === '') {
        process.stderr.write('Project name is required.\n')
        process.exit(1)
    }

    const config = loadConfig(options)
    const registry = (config['projectRegistry'] ?? {}) as Record<string, { path: string, project_number?: number }>

    if (!registry[name]) {
        process.stderr.write(`🛠️ AUTONOMOUS HEALING: Project '${name}' not found.\n`)
        process.exit(1)
    }

    const rest = Object.fromEntries(Object.entries(registry).filter(([key]) => key !== name))
    config['projectRegistry'] = rest
    saveConfig(config, options)

    process.stdout.write(`Project '${name}' successfully deleted.\n`)
}

