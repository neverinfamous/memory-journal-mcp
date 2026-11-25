/**
 * Pass 29 Adversarial Code-Quality Audit — Security, Scope, RBAC & SQLite Regressions
 * Covers H1-H10, H18: meta-group filter `-write`/`+write`, SSRF fail-closed IPv6/DNS,
 * audit `#`-fragment scope normalization, Code Mode query/git mapping, active Team RBAC,
 * SQLite online backup integrity, ConfigManager hot-reload pairing, YAML registry persistence,
 * and workspace-scoped author consolidation.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import dns from 'node:dns'
import Database from 'better-sqlite3'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { AuthorizationError, ValidationError } from '../../src/types/errors.js'
import { parseToolFilter } from '../../src/filtering/tool-filter.js'
import { TokenValidator } from '../../src/auth/token-validator.js'
import { JwksFetchError } from '../../src/auth/errors.js'
import { getRequiredScope } from '../../src/auth/scope-map.js'
import { AuditLogger } from '../../src/audit/audit-logger.js'
import { createAuditInterceptor } from '../../src/audit/interceptor.js'
import { resolveExecutionPayload } from '../../src/handlers/tools/codemode/payload-synthesizer.js'
import { ExecuteCodeSchema } from '../../src/handlers/tools/codemode/schemas.js'
import { applyGitInterceptions } from '../../src/codemode/api/git-api.js'
import {
    canReadTeamEntriesRbac,
    enforceTeamRbac,
    resolveScopedTeamRole,
} from '../../src/handlers/tools/team/rbac.js'
import { ConfigManager } from '../../src/utils/config-manager.js'
import { DEFAULT_BRIEFING_CONFIG } from '../../src/handlers/resources/shared.js'
import {
    RegistryConfigError,
    parseConfigObjectContent,
    readProjectRegistryFile,
    writeProjectRegistryFile,
} from '../../src/utils/registry-config-file.js'

describe('Pass 29 Security, Scope, RBAC & SQLite Regressions', () => {
    let db: DatabaseAdapter
    let tmpDir: string

    beforeEach(async () => {
        db = new DatabaseAdapter(':memory:')
        await db.initialize()
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-pass29-sec-'))
    })

    afterEach(() => {
        db.close()
        vi.restoreAllMocks()
        fs.rmSync(tmpDir, { recursive: true, force: true })
    })

    it('H1: supports -write and +write meta-group modifiers in parseToolFilter', () => {
        const noWrite = parseToolFilter('starter,-write')
        expect(noWrite.enabledTools.has('search_entries')).toBe(true)
        expect(noWrite.enabledTools.has('create_entry')).toBe(false)
        expect(noWrite.enabledTools.has('update_entry')).toBe(false)
        expect(noWrite.enabledTools.has('delete_entry')).toBe(false)

        const reEnabled = parseToolFilter('starter,-write,+create_entry')
        expect(reEnabled.enabledTools.has('create_entry')).toBe(true)
        expect(reEnabled.enabledTools.has('update_entry')).toBe(false)

        const withWrite = parseToolFilter('readonly,+write')
        expect(withWrite.enabledTools.has('create_entry')).toBe(true)
    })

    it('H2: TokenValidator blocks bracketed private/mapped IPv6 and mixed public+private DNS results', async () => {
        expect(
            () =>
                new TokenValidator({
                    jwksUri: 'https://[fc00::1]/.well-known/jwks.json',
                    issuer: 'https://[fc00::1]',
                    audience: 'test-aud',
                })
        ).toThrow(/SSRF Protection/i)

        expect(
            () =>
                new TokenValidator({
                    jwksUri: 'https://[::ffff:127.0.0.1]/.well-known/jwks.json',
                    issuer: 'https://[::ffff:127.0.0.1]',
                    audience: 'test-aud',
                })
        ).toThrow(/SSRF Protection/i)

        const lookupSpy = vi.spyOn(dns.promises, 'lookup').mockResolvedValue([
            { address: '93.184.216.34', family: 4 },
            { address: '10.0.0.5', family: 4 },
        ])
        const dnsValidator = new TokenValidator({
            jwksUri: 'https://auth.example.com/.well-known/jwks.json',
            issuer: 'https://auth.example.com',
            audience: 'test-aud',
        })
        await expect(dnsValidator.preload()).rejects.toSatisfy((err: unknown) => {
            return (
                err instanceof JwksFetchError &&
                typeof err.details?.['cause'] === 'string' &&
                /private\/loopback/i.test(err.details['cause'])
            )
        })
        expect(lookupSpy).toHaveBeenCalledWith('auth.example.com', { all: true })
    })

    it('H3: strips URI fragments when classifying resource scopes and auditing team/audit URIs', async () => {
        expect(getRequiredScope('memory://audit#fragment')).toBe('audit')
        expect(getRequiredScope('memory://team#frag')).toBe('team')
        expect(getRequiredScope('memory://insights/team-collaboration#x')).toBe('team')

        const auditPath = path.join(tmpDir, 'audit.jsonl')
        const auditLogger = new AuditLogger({
            logPath: auditPath,
            enabled: true,
            auditReads: false,
            redact: true,
        })
        const interceptor = createAuditInterceptor(auditLogger)
        await interceptor.around('memory://team#frag', { query: 'test' }, async () => 'ok')
        await auditLogger.close()

        const logged = fs.readFileSync(auditPath, 'utf8')
        expect(logged).toContain('memory://team#frag')
        expect(logged).toContain('"category":"team"')
    })

    it('H4 & H18: never synthesizes writes from query inputs and forwards tech_debt_audit / sort_by in Code Mode git API', () => {
        const rawParams = { query: 'write a decision entry about auth' }
        const parsed = ExecuteCodeSchema.parse(rawParams)
        const payloadRes = resolveExecutionPayload(parsed, rawParams, true, Date.now())
        expect('executionCode' in payloadRes).toBe(true)
        if ('executionCode' in payloadRes) {
            expect(payloadRes.executionCode).toContain('mj.search.searchEntries')
            expect(payloadRes.executionCode).not.toContain('createEntry')
        }

        const args: unknown[] = [{ tech_debt_audit: true, sort_by: 'impact', max_count: 15 }]
        const gitRes = applyGitInterceptions('getCommitHistory', args)
        expect(gitRes).not.toBeNull()
        const normalized = args[0] as Record<string, unknown>
        expect(normalized['techDebtAudit']).toBe(true)
        expect(normalized['sortBy']).toBe('impact')
        expect(normalized['maxCount']).toBe(15)
    })

    it('H5 & H6: enforces active Team RBAC across reads, writes, wildcard workspace, and scoped aliases', async () => {
        const teamDb = new DatabaseAdapter(':memory:')
        await teamDb.initialize()
        try {
            teamDb.addTeamMember('alice', 'admin', 'system')
            teamDb.addTeamMember('bob', 'viewer', 'alice')
            teamDb.addAuthorAlias('bobby', 'bob', 'alice', 'repo-a')

            expect(resolveScopedTeamRole(teamDb, 'bobby', 'denied', '*')).toBeNull()
            expect(resolveScopedTeamRole(teamDb, 'bobby', 'denied', 'repo-a')).toBe('viewer')

            expect(canReadTeamEntriesRbac(teamDb, { teamDefaultRole: 'denied' }, 'repo-a')).toBe(
                false
            )
            expect(() =>
                enforceTeamRbac({ db, teamDb, config: { teamDefaultRole: 'denied' } }, 'bob', 'member', '*')
            ).toThrow(AuthorizationError)
        } finally {
            teamDb.close()
        }
    })

    it('H7: BackupManager.exportToFile produces an integrity-verified SQLite snapshot', async () => {
        const fileDbPath = path.join(tmpDir, 'live.db')
        const fileDb = new DatabaseAdapter(fileDbPath)
        await fileDb.initialize()
        try {
            fileDb.createEntry({
                content: 'Snapshot integrity verification note',
                workspaceId: 'memory-journal-mcp',
                projectNumber: 5,
            })
            const backup = await fileDb.exportToFile('pass29-snap')
            expect(fs.existsSync(backup.path)).toBe(true)
            expect(backup.sizeBytes).toBeGreaterThan(0)

            const checkDb = new Database(backup.path, { readonly: true })
            try {
                const integrity = checkDb.pragma('integrity_check', { simple: true })
                expect(integrity).toBe('ok')
            } finally {
                checkDb.close()
            }
        } finally {
            fileDb.close()
        }
    })

    it('H8: ConfigManager.updateConfig rejects mismatched projectRegistry scope without mutating prior config', () => {
        const mgr = new ConfigManager({
            rawToolFilter: 'starter',
            toolFilterConfig: null,
            briefingConfig: {
                ...DEFAULT_BRIEFING_CONFIG,
                defaultWorkspaceId: 'repo-a',
                defaultProjectNumber: 1,
                projectRegistry: {
                    'repo-a': { path: '/tmp/repo-a', project_number: 1 },
                },
            },
        })

        expect(() =>
            mgr.updateConfig({
                briefingConfig: {
                    ...DEFAULT_BRIEFING_CONFIG,
                    defaultWorkspaceId: 'repo-a',
                    defaultProjectNumber: 99,
                    projectRegistry: {
                        'repo-a': { path: '/tmp/repo-a', project_number: 1 },
                    },
                },
            })
        ).toThrow(ValidationError)
        expect(mgr.getConfig().briefingConfig.defaultProjectNumber).toBe(1)
        mgr.close()
    })

    it('H9: round-trips YAML projectRegistry configs atomically and rejects malformed YAML without clobbering', () => {
        const yamlPath = path.join(tmpDir, 'memory-journal.config.yaml')
        writeProjectRegistryFile(yamlPath, {
            projectRegistry: {
                'memory-journal-mcp': { path: '/tmp/mj', project_number: 5 },
            },
        })
        const loaded = readProjectRegistryFile(yamlPath)
        expect(loaded.registry['memory-journal-mcp']).toEqual({
            path: '/tmp/mj',
            project_number: 5,
        })

        expect(() => parseConfigObjectContent(yamlPath, 'projectRegistry:\n  broken: [')).toThrow(
            RegistryConfigError
        )
    })

    it('H10: consolidateAuthors honors workspace scope and does not overwrite foreign workspaces', () => {
        db.applyTeamSchema()
        db.addAuthorAlias('nick', 'Alice Canonical', 'admin', 'repo-a')
        db.addAuthorAlias('nick', 'Foreign Canonical', 'admin', 'repo-b')

        db.createEntry({
            content: 'Workspace A entry',
            workspaceId: 'repo-a',
            projectNumber: 1,
            author: 'nick',
        })
        db.createEntry({
            content: 'Workspace B entry',
            workspaceId: 'repo-b',
            projectNumber: 2,
            author: 'nick',
        })

        const updated = db.consolidateAuthors('Alice Canonical', 'repo-a')
        expect(updated).toBe(1)
        expect(db.getAuthorStatistics('repo-a')).toEqual([{ author: 'Alice Canonical', count: 1 }])
        expect(db.removeAuthorAlias('nick', 'repo-b')).toBe(true)
        expect(db.getAuthorStatistics('repo-b')).toEqual([{ author: 'nick', count: 1 }])
    })
})
