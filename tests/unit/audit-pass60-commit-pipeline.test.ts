import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as ts from 'typescript'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { AUDIT_PROMPT_REVISION } from '../../src/handlers/prompts/adversarial-audit-factory.js'
import { getPerformanceAuditPromptDefinition } from '../../src/handlers/prompts/adversarial-performance.js'
import { getCodeQualityAuditPromptDefinition } from '../../src/handlers/prompts/adversarial-code-quality.js'
import { buildEntryPayload } from '../../src/cli/commands/entry-payload.js'

const SRC_ROOT = path.resolve(process.cwd(), 'src')
const FORBIDDEN_ENTRY_EXTERNALS = new Set([
    '@octokit/rest',
    '@octokit/graphql',
    'simple-git',
    '@modelcontextprotocol/server',
    'commander',
])
const FORBIDDEN_ENTRY_MODULES = [
    'staleness-tools',
    'hallucination-healer',
    'codemode/normalizers',
    'filtering/tool-filter',
    'team/schemas',
    'team/rbac',
    'batch-delete-helpers',
]

function isRuntimeImportClause(clause: ts.ImportClause | undefined): boolean {
    if (!clause) return true
    if (clause.isTypeOnly) return false
    if (clause.name) return true
    const bindings = clause.namedBindings
    if (!bindings) return false
    if (ts.isNamespaceImport(bindings)) return true
    return bindings.elements.some((el) => !el.isTypeOnly)
}

function isRuntimeExportDeclaration(node: ts.ExportDeclaration): boolean {
    if (node.isTypeOnly) return false
    const clause = node.exportClause
    if (!clause || ts.isNamespaceExport(clause)) return true
    return clause.elements.some((el) => !el.isTypeOnly)
}

function resolveRelativeTsFile(fromFile: string, specifier: string): string | null {
    if (!specifier.startsWith('.')) return null
    const baseDir = path.dirname(fromFile)
    const stripped = specifier.endsWith('.js') ? `${specifier.slice(0, -3)}.ts` : specifier
    for (const candidate of [
        path.resolve(baseDir, stripped),
        path.resolve(baseDir, `${specifier}.ts`),
        path.resolve(baseDir, specifier, 'index.ts'),
    ]) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
    }
    return null
}

function collectRuntimeGraph(entryFile: string): {
    visitedRel: string[]
    externals: Set<string>
} {
    const visited = new Set<string>()
    const queue = [path.resolve(entryFile)]
    const externals = new Set<string>()

    while (queue.length > 0) {
        const current = queue.pop()
        if (current === undefined || visited.has(current)) continue
        visited.add(current)

        const sf = ts.createSourceFile(
            current,
            fs.readFileSync(current, 'utf-8'),
            ts.ScriptTarget.Latest,
            false,
            ts.ScriptKind.TS
        )
        for (const stmt of sf.statements) {
            let specifierText: string | undefined
            if (ts.isImportDeclaration(stmt) && isRuntimeImportClause(stmt.importClause)) {
                if (ts.isStringLiteral(stmt.moduleSpecifier)) specifierText = stmt.moduleSpecifier.text
            } else if (ts.isExportDeclaration(stmt) && isRuntimeExportDeclaration(stmt)) {
                if (stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)) {
                    specifierText = stmt.moduleSpecifier.text
                }
            }
            if (specifierText === undefined) continue
            if (specifierText.startsWith('.')) {
                const resolved = resolveRelativeTsFile(current, specifierText)
                if (resolved !== null && !visited.has(resolved)) queue.push(resolved)
            } else {
                externals.add(specifierText)
            }
        }
    }

    const visitedRel = [...visited].map((f) => path.relative(SRC_ROOT, f).replace(/\\/g, '/'))
    return { visitedRel, externals }
}

describe('Pass 60 Audit Prompts, Entry Bundle Purity & Strict Score Parsing', () => {
    let savedEncKey: string | undefined
    let savedDbEncKey: string | undefined

    beforeEach(() => {
        savedEncKey = process.env['MJ_DB_ENCRYPTION_KEY']
        savedDbEncKey = process.env['DB_ENCRYPTION_KEY']
        delete process.env['MJ_DB_ENCRYPTION_KEY']
        delete process.env['DB_ENCRYPTION_KEY']
    })

    afterEach(() => {
        if (savedEncKey !== undefined) process.env['MJ_DB_ENCRYPTION_KEY'] = savedEncKey
        if (savedDbEncKey !== undefined) process.env['DB_ENCRYPTION_KEY'] = savedDbEncKey
    })

    it('AP1–AP3: bumps AUDIT_PROMPT_REVISION to pass60 and includes Pass 60 intra-repo chunk & exit-boundary checks', async () => {
        expect(AUDIT_PROMPT_REVISION).toBe('2026-11-24-audit-pass85')

        const dbPath = path.join(
            os.tmpdir(),
            `mj-pass60-prompts-${String(process.pid)}-${String(Date.now())}.db`
        )
        const adapter = new DatabaseAdapter(dbPath, { projectRegistry: {} })
        try {
            await adapter.initialize()

            const perfRes = await getPerformanceAuditPromptDefinition().handler(
                { target: 'src', copilot: 'false' },
                adapter
            )
            const perfText = perfRes.messages[0]?.content.text ?? ''
            expect(perfText).toContain('Prompt revision: 2026-11-24-audit-pass85')
            expect(perfText).toContain('intra-repo chunk composition')
            expect(perfText).toContain('statSync')
            expect(perfText).toContain('explore')
            expect(perfText).toContain('generalPurpose')
            expect(perfText).not.toMatch(/[A-Z]:\\Users\\/i)

            const cqRes = await getCodeQualityAuditPromptDefinition().handler(
                { target: 'src', copilot: 'false' },
                adapter
            )
            const cqText = cqRes.messages[0]?.content.text ?? ''
            expect(cqText).toContain('Prompt revision: 2026-11-24-audit-pass85')
            expect(cqText).toContain('path.resolve(cwd, "")')
            expect(cqText).toContain("process.on('exit', ...)")
            expect(cqText).toContain('auxiliary automation scripts')
            expect(cqText).toContain('process.exit(1)')
            expect(cqText).toContain('explore')
            expect(cqText).toContain('generalPurpose')
            expect(cqText).not.toMatch(/[A-Z]:\\Users\\/i)
        } finally {
            adapter.close()
            if (fs.existsSync(dbPath)) fs.rmSync(dbPath, { force: true })
        }
    })

    it('P-H1: CLI entry runtime import graph excludes staleness-tools, healers, codemode normalizers, tool-filter, team schemas, and rbac', () => {
        const entryFile = path.join(SRC_ROOT, 'cli', 'commands', 'entry.ts')
        const { visitedRel, externals } = collectRuntimeGraph(entryFile)

        for (const forbiddenExt of FORBIDDEN_ENTRY_EXTERNALS) {
            expect(externals.has(forbiddenExt)).toBe(false)
        }
        for (const forbiddenMod of FORBIDDEN_ENTRY_MODULES) {
            const hits = visitedRel.filter((rel) => rel.includes(forbiddenMod))
            expect(hits).toEqual([])
        }
    })

    it('Q-M3: buildEntryPayload rejects blank, boolean, and non-decimal trust/impact scores while omitting null', () => {
        for (const badVal of ['', '   ', false, true, '0x1', '0b1']) {
            expect(() =>
                buildEntryPayload(
                    {},
                    {
                        workspace_id: 'memory-journal-mcp',
                        project_number: 5,
                        trust: badVal,
                    }
                )
            ).toThrow(/Invalid trust\/confidence score/)

            expect(() =>
                buildEntryPayload(
                    {},
                    {
                        workspace_id: 'memory-journal-mcp',
                        project_number: 5,
                        impact: badVal,
                    }
                )
            ).toThrow(/Invalid impact score/)
        }

        const omitted = buildEntryPayload(
            {},
            {
                workspace_id: 'memory-journal-mcp',
                project_number: 5,
                trust: null,
                impact: null,
            }
        )
        expect(omitted.trustScore).toBeUndefined()
        expect(omitted.impactScore).toBeUndefined()
    })
})
