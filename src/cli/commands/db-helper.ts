import * as fsPromises from 'node:fs/promises'
import * as path from 'node:path'
import type { IDatabaseAdapter, TeamRole } from '../../database/core/interfaces.js'
import type { ServerOptions } from '../../server/mcp-server/types.js'
import type { ToolHandlerConfig } from '../../types/index.js'
import { ValidationError } from '../../types/errors.js'
import {
    enforceTeamRbac,
    getCallerIdentity,
} from '../../handlers/tools/team/rbac.js'
import { assertSafeDirectoryPath, assertSafeFilePath } from '../../utils/security-utils.js'
import { getErrnoCode } from '../../utils/type-guards.js'
import { assertSyntacticallySafeCliPath } from './cli-input-reader.js'
import {
    findCanonicalRegistryKey,
    loadProjectRegistryFromConfig,
    resolveCliQueryScope,
} from '../../utils/workspace-resolver.js'
import { CliExitError, getCliCommandDb } from './db-core.js'

export { CliExitError, getCliCommandDb }

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
 * Rejects wildcard `'*'` or unresolved `projectNumber` unless the caller holds `'admin'` team RBAC role.
 */
export function enforceCliTeamReadScope(
    db: IDatabaseAdapter,
    config: ToolHandlerConfig,
    workspaceId: string,
    projectNumber: number | undefined
): void {
    const rbacActive = typeof db.isTeamRbacActive === 'function' && db.isTeamRbacActive()
    if (projectNumber === undefined) {
        enforceCliTeamRbac(db, config, rbacActive ? 'admin' : 'viewer', workspaceId)
        if (workspaceId === '*' && !rbacActive) {
            throw new ValidationError(
                "Cross-tenant wildcard '--workspace *' on --team reads requires an explicit --default-project unless the caller holds the 'admin' team RBAC role."
            )
        }
        if (workspaceId !== '*') {
            throw new ValidationError(
                'Missing project_number for --team read on shared/unregistered workspace. Pass --default-project or register the workspace in projectRegistry.'
            )
        }
        return
    }
    enforceCliTeamRbac(db, config, 'viewer', workspaceId)
}

/**
 * Resolve CLI read query scope and enforce Team RBAC + wildcard guards when `--team` is active.
 */
export function resolveCliReadScope(
    db: IDatabaseAdapter,
    serverOptions: ServerOptions,
    options: { workspace?: string | undefined; defaultProject?: number | undefined; team?: boolean | undefined }
): { workspaceId: string; projectNumber?: number } {
    if (options.workspace?.trim() === '') {
        throw new ValidationError("Invalid --workspace '': expected a non-empty workspace identifier.")
    }
    const trimmedWs = options.workspace?.trim()
    const scope = resolveCliQueryScope(
        trimmedWs !== undefined && trimmedWs !== '' ? trimmedWs : undefined,
        options.defaultProject,
        serverOptions
    )
    if (options.team === true) {
        if (scope.projectNumber === undefined && scope.workspaceId !== '*') {
            const registry = serverOptions.projectRegistry ?? loadProjectRegistryFromConfig()
            const canonicalKey = findCanonicalRegistryKey(scope.workspaceId, registry)
            const regProject =
                canonicalKey !== undefined &&
                registry !== undefined &&
                Object.hasOwn(registry, canonicalKey)
                    ? registry[canonicalKey]?.project_number
                    : undefined
            if (
                typeof regProject === 'number' &&
                Number.isSafeInteger(regProject) &&
                regProject >= 1
            ) {
                scope.projectNumber = regProject
            }
        }
        enforceCliTeamReadScope(db, serverOptions, scope.workspaceId, scope.projectNumber)
    }
    return scope
}

/** Walk `dirPath` and every existing ancestor upward, rejecting any symlink. */
export async function assertNonSymlinkCliAncestors(dirPath: string): Promise<void> {
    const ancestors: string[] = []
    let current = path.resolve(dirPath)
    while (true) {
        ancestors.push(current)
        const parent = path.dirname(current)
        if (parent === current) break
        current = parent
    }
    await ancestors.reduce<Promise<void>>(async (prev, ancestor) => {
        await prev
        try {
            const stats = await fsPromises.lstat(ancestor)
            if (stats.isSymbolicLink()) {
                throw new Error(`Symlinks are forbidden for CLI directory paths: ${ancestor}`)
            }
        } catch (err: unknown) {
            if (getErrnoCode(err) !== 'ENOENT') {
                throw err
            }
        }
    }, Promise.resolve())
}

/** Validate a CLI directory flag against null bytes, ancestor symlinks, and path traversal. */
export async function assertSafeCliDir(dir: string | undefined, label: string): Promise<string> {
    if (dir === undefined || dir.trim() === '') {
        throw new Error(`--dir is required for ${label}`)
    }
    if (dir.includes('\0')) {
        throw new Error('Invalid directory path: null bytes are not allowed')
    }
    const trimmed = dir.trim()
    assertSyntacticallySafeCliPath(trimmed, '--dir')
    const resolvedDir = path.resolve(trimmed)
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
    assertSyntacticallySafeCliPath(trimmed, flagName)
    const resolvedPath = path.resolve(trimmed)
    const destDir = path.dirname(resolvedPath)
    await assertNonSymlinkCliAncestors(destDir)
    assertSafeFilePath(resolvedPath, [destDir])
    return resolvedPath
}
