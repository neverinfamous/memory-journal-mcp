import * as fsPromises from 'node:fs/promises'
import * as path from 'node:path'
import type { Command } from 'commander'
import { DatabaseAdapterFactory } from '../../database/adapter-factory.js'
import type { IDatabaseAdapter, TeamRole } from '../../database/core/interfaces.js'
import type { ServerOptions } from '../../server/mcp-server/types.js'
import type { ToolHandlerConfig } from '../../types/index.js'
import { ValidationError } from '../../types/errors.js'
import {
    enforceTeamRbac,
    getCallerIdentity,
    isCallerTeamAdmin,
} from '../../handlers/tools/team/rbac.js'
import { ConfigResolver } from '../../utils/config-resolver.js'
import { assertSafeDirectoryPath, assertSafeFilePath } from '../../utils/security-utils.js'
import { resolveCliQueryScope } from '../../utils/workspace-resolver.js'
import { buildServerOptions } from '../server-options-builder.js'
import { dumpConfigAndExit } from '../dump-config.js'

/** Sentinel error carrying an exit code so DB-backed CLI actions run `finally { db.close() }` before exiting. */
export class CliExitError extends Error {
    public readonly exitCode: number

    constructor(exitCode: number) {
        super(`CLI command exited with code ${String(exitCode)}`)
        this.name = 'CliExitError'
        this.exitCode = exitCode
    }
}

export function enforceCliTeamRbac(
    db: IDatabaseAdapter,
    config: ToolHandlerConfig,
    requiredRole: TeamRole,
    workspaceId?: string
): void {
    enforceTeamRbac({ db, teamDb: db, config }, getCallerIdentity(), requiredRole, workspaceId)
}

/**
 * Enforce Team RBAC on `--team` CLI read commands (`search`, `session`, `analytics`, `visualize`).
 * Rejects wildcard `'*'` without an explicit `projectNumber` unless the caller holds `'admin'` team RBAC role.
 */
export function enforceCliTeamReadScope(
    db: IDatabaseAdapter,
    config: ToolHandlerConfig,
    workspaceId: string,
    projectNumber: number | undefined
): void {
    enforceCliTeamRbac(db, config, 'viewer', workspaceId)
    if (workspaceId === '*' && projectNumber === undefined) {
        if (db.isTeamRbacActive()) {
            enforceCliTeamRbac(db, config, 'admin', workspaceId)
        }
        if (!isCallerTeamAdmin(db, getCallerIdentity(), config, workspaceId)) {
            throw new ValidationError(
                "Cross-tenant wildcard '--workspace *' on --team reads requires an explicit --default-project unless the caller holds the 'admin' team RBAC role."
            )
        }
    }
}

/**
 * Resolve CLI read query scope and enforce Team RBAC + wildcard guards when `--team` is active.
 */
export function resolveCliReadScope(
    db: IDatabaseAdapter,
    serverOptions: ServerOptions,
    options: { workspace?: string; defaultProject?: number; team?: boolean }
): { workspaceId: string; projectNumber?: number } {
    const trimmedWs = options.workspace?.trim()
    const scope = resolveCliQueryScope(
        trimmedWs !== undefined && trimmedWs !== '' ? trimmedWs : undefined,
        options.defaultProject,
        serverOptions
    )
    if (options.team === true) {
        enforceCliTeamReadScope(db, serverOptions, scope.workspaceId, scope.projectNumber)
    }
    return scope
}

/** Walk `dirPath` and every existing ancestor upward, rejecting any symlink. */
export async function assertNonSymlinkCliAncestors(dirPath: string): Promise<void> {
    let current = path.resolve(dirPath)
    while (true) {
        try {
            const stats = await fsPromises.lstat(current)
            if (stats.isSymbolicLink()) {
                throw new Error(`Symlinks are forbidden for CLI directory paths: ${current}`)
            }
        } catch (err: unknown) {
            const code =
                typeof err === 'object' && err !== null && 'code' in err ? err.code : undefined
            if (code !== 'ENOENT') {
                throw err
            }
        }
        const parent = path.dirname(current)
        if (parent === current) break
        current = parent
    }
}

/** Validate a CLI directory flag against null bytes, ancestor symlinks, and path traversal. */
export async function assertSafeCliDir(dir: string | undefined, label: string): Promise<string> {
    if (dir === undefined || dir.trim() === '') {
        throw new Error(`--dir is required for ${label}`)
    }
    if (dir.includes('\0')) {
        throw new Error('Invalid directory path: null bytes are not allowed')
    }
    const resolvedDir = path.resolve(dir.trim())
    await assertNonSymlinkCliAncestors(resolvedDir)
    assertSafeDirectoryPath(resolvedDir, [resolvedDir])
    return resolvedDir
}

/** Validate a CLI output file path against empty strings, null bytes, ancestor symlinks, and file symlinks. */
export async function assertSafeCliOutputFile(
    rawPath: string,
    flagName: string
): Promise<string> {
    if (rawPath.includes('\0')) {
        throw new Error('Invalid destination path: null bytes are not allowed')
    }
    const trimmed = rawPath.trim()
    if (trimmed === '') {
        throw new Error(`${flagName} path cannot be empty`)
    }
    const resolvedPath = path.resolve(trimmed)
    const destDir = path.dirname(resolvedPath)
    await assertNonSymlinkCliAncestors(destDir)
    assertSafeFilePath(resolvedPath, [destDir])
    return resolvedPath
}

export async function getCliCommandDb(
    options: Record<string, unknown> & { config?: string; team?: boolean },
    command: Command
): Promise<{ db: IDatabaseAdapter; serverOptions: ServerOptions }> {
    let resolver: ConfigResolver
    const configPath = options.config ?? process.env['MEMORY_JOURNAL_CONFIG']
    const configErrors: string[] = []

    try {
        resolver = new ConfigResolver(command, options, configPath)
    } catch (err) {
        configErrors.push(err instanceof Error ? err.message : String(err))
        resolver = new ConfigResolver(command, {}, undefined)
    }

    const { serverOptions, teamDb } = buildServerOptions(resolver, options, command, configErrors)

    if (configErrors.length > 0) {
        process.stderr.write('Startup Configuration Errors:\n')
        configErrors.forEach((err) => process.stderr.write(` - ${err}\n`))
        process.exit(1)
    }

    // [INVARIANT] `--dump-config` is answered before any database is opened (H13).
    if (options['dumpConfig'] === true) {
        dumpConfigAndExit(serverOptions)
    }

    const explicitTeamDbSource =
        (typeof options['teamDb'] === 'string' && options['teamDb'].trim() !== '') ||
        (typeof options['teamDatabase'] === 'string' && options['teamDatabase'].trim() !== '') ||
        (typeof options['testTeamDb'] === 'string' && options['testTeamDb'].trim() !== '')
    if (explicitTeamDbSource && options.team !== true) {
        process.stderr.write(
            'Error: --team-db/--team-database/--test-team-db requires --team to target the team database.\n'
        )
        process.exit(1)
    }

    if (options.team && !teamDb) {
        process.stderr.write(
            'Error: --team requires a configured team database (--team-db or TEAM_DB_PATH).\n'
        )
        process.exit(1)
    }
    const dbPath = options.team && teamDb ? teamDb : serverOptions.dbPath
    const db = await DatabaseAdapterFactory.create(dbPath, serverOptions)
    await db.initialize()
    if (options.team === true) {
        try {
            db.applyTeamSchema()
            if (
                serverOptions.teamAdmin &&
                db.getTeamMemberCount !== undefined &&
                db.addTeamMember !== undefined &&
                !db.isTeamRbacActive?.()
            ) {
                db.addTeamMember(serverOptions.teamAdmin, 'admin', 'system', 'Bootstrap Admin')
            }
        } catch (err) {
            db.close()
            throw err
        }
    }
    return { db, serverOptions }
}
