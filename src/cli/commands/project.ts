import { type Command } from 'commander'
import * as path from 'node:path'
import * as fs from 'node:fs'

import { DatabaseAdapterFactory } from '../../database/adapter-factory.js'
import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import type { ServerOptions } from '../../server/mcp-server/types.js'
import { ConfigResolver } from '../../utils/config-resolver.js'
import {
    readProjectRegistryFile,
    writeProjectRegistryFile,
} from '../../utils/registry-config-file.js'
import {
    findCaseInsensitiveKeyConflict,
    findProjectNumberConflict,
    isForbiddenProjectKey,
    isValidProjectPath,
} from '../../utils/project-registry-guards.js'
import { validateProjectRegistryObject } from '../server-options-parsers.js'
import { buildServerOptions } from '../server-options-builder.js'
import { parsePositiveProjectNumber } from '../../utils/safe-positive-int.js'
import { dumpConfigAndExit } from '../dump-config.js'
import { formatCliError } from './cli-output.js'
import {
    resolveProjectConfigPath,
    syncCliTopLevelDefaults,
    withIsolatedProjectConfigEnv,
} from './project-config-helper.js'

function isJsonOutput(options: Record<string, unknown>, command: Command): boolean {
    if (options['json'] === true) return true
    if (options['json'] === false) return false
    const globals = command.optsWithGlobals<Record<string, unknown>>()
    return globals['json'] === true
}

function handleProjectDumpConfig(options: Record<string, unknown>, command: Command): void {
    if (options['dumpConfig'] !== true) return
    const { serverOptions, configErrors } = withIsolatedProjectConfigEnv(options, (cliConfigPath) => {
        let resolver: ConfigResolver
        const errors: string[] = []
        try {
            resolver = new ConfigResolver(command, options, cliConfigPath)
        } catch (err) {
            errors.push(err instanceof Error ? err.message : String(err))
            resolver = new ConfigResolver(command, {}, undefined)
        }
        const { serverOptions: built } = buildServerOptions(resolver, options, command, errors)
        return { serverOptions: built, configErrors: errors }
    })
    if (configErrors.length > 0) {
        process.stderr.write('Startup Configuration Errors:\n')
        configErrors.forEach((err) => process.stderr.write(` - ${formatCliError(err)}\n`))
        process.exit(1)
    }
    dumpConfigAndExit(serverOptions)
}

function loadConfig(options?: Record<string, unknown>): Record<string, unknown> {
    return readProjectRegistryFile(resolveProjectConfigPath(options)).config
}

function saveConfig(config: Record<string, unknown>, options?: Record<string, unknown>): void {
    writeProjectRegistryFile(resolveProjectConfigPath(options), config)
}

function parsePositiveCliProjectNumber(raw: unknown): number {
    const parsed = parsePositiveProjectNumber(typeof raw === 'string' ? raw.trim() : raw)
    if (parsed === undefined || (typeof raw === 'string' && !/^[1-9]\d*$/.test(raw.trim()))) {
        process.stderr.write('Invalid project number.\n')
        process.exit(1)
    }
    return parsed
}

export function projectListAction(options: Record<string, unknown>, command: Command): void {
    handleProjectDumpConfig(options, command)
    const config = loadConfig(options)
    const registry = (config['projectRegistry'] ?? {}) as Record<string, { path: string, project_number?: number }>
    
    if (isJsonOutput(options, command)) {
        process.stdout.write(JSON.stringify(registry, null, 2) + '\n')
        return
    }

    if (Object.keys(registry).length === 0) {
        process.stdout.write('No projects registered.\n')
        return
    }

    for (const [name, data] of Object.entries(registry)) {
        process.stdout.write(`${name}: ${data.path} (Project Number: ${data.project_number ?? 'None'})\n`)
    }
}

function buildValidatedProjectServerOptions(
    options: Record<string, unknown>,
    command: Command
): ServerOptions | undefined {
    return withIsolatedProjectConfigEnv(options, (cliConfigPath) => {
        const existingCliConfig =
            cliConfigPath !== undefined && fs.existsSync(path.resolve(cliConfigPath))
                ? cliConfigPath
                : undefined

        let resolver: ConfigResolver
        try {
            resolver = new ConfigResolver(command, options, existingCliConfig)
        } catch (e) {
            process.stderr.write(
                `\nInvalid configuration, refusing to register project: ${formatCliError(e)}\n`
            )
            process.stderr.write(
                `Fix the configuration and run 'memory-journal-mcp entry create' manually.\n`
            )
            process.exitCode = 1
            return undefined
        }

        const configErrors: string[] = []
        const { serverOptions } = buildServerOptions(resolver, options, command, configErrors)
        if (configErrors.length > 0) {
            // [INVARIANT] Never persist or initialize a database from a configuration that failed validation (H13/H16).
            process.stderr.write('\nInvalid configuration, refusing to register project:\n')
            configErrors.forEach((err) => process.stderr.write(` - ${formatCliError(err)}\n`))
            process.exitCode = 1
            return undefined
        }
        return serverOptions
    })
}

function isValidExplicitProjectName(name: string): boolean {
    return name !== '' && name.trim() !== '' && name === name.trim() && !isForbiddenProjectKey(name)
}

function validateAndRegisterProjectEntry(
    name: string,
    options: Record<string, unknown>,
    command: Command
): { absPath: string; serverOptions: ServerOptions; effectiveProjNum: number | undefined } | undefined {
    if (!isValidExplicitProjectName(name)) {
        process.stderr.write('Invalid project name.\n')
        process.exit(1)
    }
    const rawPath = options['path']
    if (typeof rawPath !== 'string' || rawPath.trim() === '') {
        process.stderr.write('Project path is required (--path).\n')
        process.exit(1)
    }

    const absPath = path.resolve(process.cwd(), rawPath)
    if (!isValidProjectPath(absPath)) {
        process.stderr.write(`Invalid or unsafe project path: '${absPath}'.\n`)
        process.exit(1)
    }

    const config = loadConfig(options)
    config['projectRegistry'] ??= {}
    const registry = config['projectRegistry'] as Record<
        string,
        { path: string; project_number?: number }
    >
    const keyConflict = findCaseInsensitiveKeyConflict(registry, name)
    if (keyConflict !== undefined) {
        process.stderr.write(`Project '${keyConflict}' already exists (conflicts with '${name}').\n`)
        process.exit(1)
    }

    const newEntry: { path: string; project_number?: number } = { path: absPath }
    if (options['number'] != null) {
        const projNum = parsePositiveCliProjectNumber(options['number'])
        const numConflict = findProjectNumberConflict(registry, projNum, [name])
        if (numConflict !== undefined) {
            process.stderr.write(
                `Project number ${String(projNum)} is already assigned to project '${numConflict}'.\n`
            )
            process.exit(1)
        }
        newEntry.project_number = projNum
    }
    registry[name] = newEntry

    try {
        validateProjectRegistryObject(config['projectRegistry'])
    } catch (e: unknown) {
        process.stderr.write(
            `Invalid project registry entry: ${e instanceof Error ? e.message : String(e)}\n`
        )
        process.exit(1)
    }

    const serverOptions = buildValidatedProjectServerOptions(options, command)
    if (serverOptions === undefined) return undefined

    saveConfig(config, options)
    serverOptions.projectRegistry = registry
    if (serverOptions.briefingConfig !== undefined) {
        serverOptions.briefingConfig.projectRegistry = registry
    }
    return { absPath, serverOptions, effectiveProjNum: newEntry.project_number }
}

async function createProjectInitEntry(
    name: string,
    absPath: string,
    effectiveProjNum: number,
    serverOptions: ServerOptions,
    isJson: boolean
): Promise<void> {
    let db: IDatabaseAdapter | undefined
    try {
        db = await DatabaseAdapterFactory.create(serverOptions.dbPath, serverOptions)
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
        process.stderr.write(
            `\nFailed to automatically initialize database entry: ${formatCliError(e)}\n`
        )
        process.stderr.write(`You may need to run 'memory-journal-mcp entry create' manually.\n`)
        process.exitCode = 1
    } finally {
        db?.close()
    }
}

export async function projectCreateAction(
    name: string,
    options: Record<string, unknown>,
    command: Command
): Promise<void> {
    handleProjectDumpConfig(options, command)
    const registered = validateAndRegisterProjectEntry(name, options, command)
    if (!registered) return

    const { absPath, serverOptions, effectiveProjNum } = registered
    const isJson = isJsonOutput(options, command)
    if (!isJson) {
        process.stdout.write(`Project '${name}' successfully registered at ${absPath}.\n`)
    }

    if (options['skipInit'] === true || effectiveProjNum === undefined) {
        if (isJson) {
            process.stdout.write(
                JSON.stringify({ status: 'success', name, path: absPath, initialized: false }) +
                    '\n'
            )
        } else {
            process.stdout.write(
                options['skipInit'] === true
                    ? `\nSkipping automated database initialization (--skip-init).\n`
                    : `\nSkipping automated database initialization because no project number was specified (use --number <n> to create an initialization entry).\n`
            )
        }
        return
    }

    await createProjectInitEntry(name, absPath, effectiveProjNum, serverOptions, isJson)
}

function applyProjectUpdateFields(
    name: string,
    options: Record<string, unknown>,
    registry: Record<string, { path: string; project_number?: number }>,
    project: { path: string; project_number?: number }
): { targetName: string; modified: boolean } {
    let modified = false
    if (options['path'] != null) {
        const rawPath = options['path']
        if (typeof rawPath !== 'string' || rawPath.trim() === '') {
            process.stderr.write('Invalid project path (--path must be a non-empty string).\n')
            process.exit(1)
        }
        const absPath = path.resolve(process.cwd(), rawPath)
        if (!isValidProjectPath(absPath)) {
            process.stderr.write(`Invalid or unsafe project path: '${absPath}'.\n`)
            process.exit(1)
        }
        project.path = absPath
        modified = true
    }

    const targetName =
        typeof options['rename'] === 'string'
            ? options['rename'].trim()
            : options['rename'] !== undefined
              ? ''
              : name
    if (targetName === '' || isForbiddenProjectKey(targetName)) {
        process.stderr.write('--rename requires a valid non-empty project name.\n')
        process.exit(1)
    }
    if (targetName !== name) {
        // [INVARIANT] Renaming must never silently overwrite another registered project (H13/H16).
        if (Object.hasOwn(registry, targetName)) {
            process.stderr.write(`Project '${targetName}' already exists; refusing to overwrite it.\n`)
            process.exit(1)
        }
        const renameConflict = findCaseInsensitiveKeyConflict(registry, targetName, name)
        if (renameConflict !== undefined) {
            process.stderr.write(
                `Project '${renameConflict}' already exists (conflicts with '${targetName}'); refusing to overwrite.\n`
            )
            process.exit(1)
        }
        modified = true
    }

    if (options['number'] != null) {
        const nextNum = parsePositiveCliProjectNumber(options['number'])
        const numConflict = findProjectNumberConflict(registry, nextNum, [name, targetName])
        if (numConflict !== undefined) {
            process.stderr.write(
                `Project number ${String(nextNum)} is already assigned to project '${numConflict}'.\n`
            )
            process.exit(1)
        }
        project.project_number = nextNum
        modified = true
    }

    return { targetName, modified }
}

export function projectUpdateAction(name: string, options: Record<string, unknown>, command: Command): void {
    handleProjectDumpConfig(options, command)
    if (!isValidExplicitProjectName(name)) {
        process.stderr.write('Invalid project name.\n')
        process.exit(1)
    }

    const config = loadConfig(options)
    const registry = (config['projectRegistry'] ?? {}) as Record<string, { path: string, project_number?: number }>

    if (!Object.hasOwn(registry, name)) {
        process.stderr.write(`🛠️ AUTONOMOUS HEALING: Project '${name}' not found.\n`)
        process.exit(1)
    }

    const existing = registry[name] ?? { path: '' }
    const prevProjNum = existing.project_number
    const project = { ...existing }
    const { targetName, modified } = applyProjectUpdateFields(name, options, registry, project)
    if (!modified) {
        if (isJsonOutput(options, command)) {
            process.stdout.write(
                JSON.stringify({
                    status: 'unchanged',
                    name,
                    path: project.path,
                    ...(project.project_number !== undefined
                        ? { project_number: project.project_number }
                        : {}),
                }) + '\n'
            )
        } else {
            process.stdout.write('No updates specified.\n')
        }
        return
    }

    const rest = Object.fromEntries(Object.entries(registry).filter(([key]) => key !== name))
    const newRegistry = { ...rest, [targetName]: project }
    config['projectRegistry'] = newRegistry
    syncCliTopLevelDefaults(config, name, targetName, prevProjNum, project.project_number)
    try {
        validateProjectRegistryObject(config['projectRegistry'])
    } catch (e: unknown) {
        process.stderr.write(
            `Invalid project registry entry: ${e instanceof Error ? e.message : String(e)}\n`
        )
        process.exit(1)
    }
    saveConfig(config, options)

    if (isJsonOutput(options, command)) {
        process.stdout.write(
            JSON.stringify({
                status: 'success',
                action: 'update',
                name: targetName,
                previousName: name,
                path: project.path,
                ...(project.project_number !== undefined
                    ? { project_number: project.project_number }
                    : {}),
            }) + '\n'
        )
    } else {
        process.stdout.write(`Project '${targetName}' successfully updated.\n`)
    }
}

export function projectDeleteAction(name: string, options: Record<string, unknown>, command: Command): void {
    handleProjectDumpConfig(options, command)
    if (!isValidExplicitProjectName(name)) {
        process.stderr.write('Project name is required.\n')
        process.exit(1)
    }

    const config = loadConfig(options)
    const registry = (config['projectRegistry'] ?? {}) as Record<string, { path: string, project_number?: number }>

    if (!Object.hasOwn(registry, name)) {
        process.stderr.write(`🛠️ AUTONOMOUS HEALING: Project '${name}' not found.\n`)
        process.exit(1)
    }

    const prevProjNum = registry[name]?.project_number
    const rest = Object.fromEntries(Object.entries(registry).filter(([key]) => key !== name))
    config['projectRegistry'] = rest
    syncCliTopLevelDefaults(config, name, undefined, prevProjNum)
    saveConfig(config, options)

    if (isJsonOutput(options, command)) {
        process.stdout.write(JSON.stringify({ status: 'success', action: 'delete', name }) + '\n')
    } else {
        process.stdout.write(`Project '${name}' successfully deleted.\n`)
    }
}

