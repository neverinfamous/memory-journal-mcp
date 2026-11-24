import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { CANONICAL_SERVER_ENV_KEYS } from '../server-options-groups.js'
import { ConfigurationError } from '../../types/errors.js'

const DEFAULT_PROJECT_CONFIG_PATH = path.resolve(
    os.homedir(),
    '.gemini',
    'config',
    'memory-journal.config.json'
)

const AMBIENT_PROJECT_CONFIG_ENV_KEYS = CANONICAL_SERVER_ENV_KEYS

export function resolveProjectConfigPath(options?: Record<string, unknown>): string {
    const rawOpt = options?.['config']
    if (typeof rawOpt === 'string' && rawOpt.trim() === '') {
        throw new ConfigurationError('Invalid blank --config path.')
    }
    const cliConfig = typeof rawOpt === 'string' ? rawOpt.trim() : undefined
    const envConfig = process.env['MEMORY_JOURNAL_CONFIG']?.trim()
    const custom = cliConfig ?? (envConfig !== undefined && envConfig !== '' ? envConfig : undefined)
    return custom !== undefined ? path.resolve(custom) : DEFAULT_PROJECT_CONFIG_PATH
}

/**
 * Isolate an explicit `--config` path from ambient env vars, `.env` defaults,
 * and fallback config discovery (`~/.gemini/config`, `.memory-journal/config.json`).
 */
export function withIsolatedProjectConfigEnv<T>(
    options: Record<string, unknown>,
    fn: (isolatedConfigPath: string | undefined) => T
): T {
    const rawOpt = options['config']
    if (typeof rawOpt === 'string' && rawOpt.trim() === '') {
        throw new ConfigurationError('Invalid blank --config path.')
    }
    const explicitConfig = typeof rawOpt === 'string' ? path.resolve(rawOpt.trim()) : undefined
    if (explicitConfig === undefined) {
        const envConfig = process.env['MEMORY_JOURNAL_CONFIG']?.trim()
        return fn(envConfig !== undefined && envConfig !== '' ? envConfig : undefined)
    }

    const savedEnv = new Map<string, string | undefined>()
    let tempDir: string | undefined
    try {
        for (const key of AMBIENT_PROJECT_CONFIG_ENV_KEYS) {
            savedEnv.set(key, process.env[key])
            process.env[key] = ''
        }
        let targetConfigPath = explicitConfig
        if (!fs.existsSync(explicitConfig)) {
            tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-proj-cfg-'))
            targetConfigPath = path.join(tempDir, 'memory-journal.config.json')
            fs.writeFileSync(targetConfigPath, '{}', 'utf-8')
        }
        process.env['MEMORY_JOURNAL_CONFIG'] = targetConfigPath
        return fn(targetConfigPath)
    } finally {
        for (const [key, prev] of savedEnv.entries()) {
            if (prev === undefined) {
                Reflect.deleteProperty(process.env, key)
            } else {
                process.env[key] = prev
            }
        }
        if (tempDir !== undefined) {
            fs.rmSync(tempDir, { recursive: true, force: true })
        }
    }
}

/**
 * Case-insensitively synchronize or clear top-level `defaultWorkspaceId` and
 * `defaultProjectNumber` when a project entry is updated or deleted.
 */
export function syncCliTopLevelDefaults(
    config: Record<string, unknown>,
    fromName: string,
    toName: string | undefined,
    prevProjNum?: number,
    nextProjNum?: number
): void {
    const currentWs =
        typeof config['defaultWorkspaceId'] === 'string' ? config['defaultWorkspaceId'] : undefined
    const matchesWs = currentWs?.toLowerCase() === fromName.toLowerCase()
    const currentProj =
        typeof config['defaultProjectNumber'] === 'number'
            ? config['defaultProjectNumber']
            : undefined
    const matchesProj =
        prevProjNum !== undefined && currentProj !== undefined && currentProj === prevProjNum

    if (toName !== undefined) {
        if (matchesWs) {
            config['defaultWorkspaceId'] = toName
        }
        if ((matchesWs || matchesProj) && typeof nextProjNum === 'number') {
            config['defaultProjectNumber'] = nextProjNum
        }
        return
    }

    if (matchesWs) {
        delete config['defaultWorkspaceId']
    }
    if (matchesWs || matchesProj) {
        delete config['defaultProjectNumber']
    }
}
