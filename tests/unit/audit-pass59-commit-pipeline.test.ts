import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as ts from 'typescript'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { AUDIT_PROMPT_REVISION } from '../../src/handlers/prompts/adversarial-audit-factory.js'
import { getPerformanceAuditPromptDefinition } from '../../src/handlers/prompts/adversarial-performance.js'
import { getCodeQualityAuditPromptDefinition } from '../../src/handlers/prompts/adversarial-code-quality.js'

const SRC_ROOT = path.resolve(process.cwd(), 'src')
const FORBIDDEN_ENTRY_EXTERNALS = new Set([
    '@octokit/rest',
    '@octokit/graphql',
    'simple-git',
    '@modelcontextprotocol/server',
    'commander',
])

function isRuntimeImportClause(clause: ts.ImportClause | undefined): boolean {
    if (!clause) return true // side-effect import
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
    const direct = path.resolve(baseDir, stripped)
    if (fs.existsSync(direct) && fs.statSync(direct).isFile()) return direct
    const tsWithExt = path.resolve(baseDir, `${specifier}.ts`)
    if (fs.existsSync(tsWithExt) && fs.statSync(tsWithExt).isFile()) return tsWithExt
    const indexTs = path.resolve(baseDir, specifier, 'index.ts')
    if (fs.existsSync(indexTs) && fs.statSync(indexTs).isFile()) return indexTs
    return null
}

function collectRuntimeGraph(entryFile: string): {
    visitedFiles: string[]
    externals: Set<string>
} {
    const visited = new Set<string>()
    const queue = [path.resolve(entryFile)]
    const externals = new Set<string>()

    while (queue.length > 0) {
        const current = queue.pop()
        if (current === undefined || visited.has(current)) continue
        visited.add(current)

        const sourceText = fs.readFileSync(current, 'utf-8')
        const sourceFile = ts.createSourceFile(
            current,
            sourceText,
            ts.ScriptTarget.Latest,
            false,
            ts.ScriptKind.TS
        )

        for (const stmt of sourceFile.statements) {
            let specifierText: string | undefined
            if (ts.isImportDeclaration(stmt) && isRuntimeImportClause(stmt.importClause)) {
                if (ts.isStringLiteral(stmt.moduleSpecifier)) {
                    specifierText = stmt.moduleSpecifier.text
                }
            } else if (ts.isExportDeclaration(stmt) && isRuntimeExportDeclaration(stmt)) {
                if (stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)) {
                    specifierText = stmt.moduleSpecifier.text
                }
            }

            if (specifierText === undefined) continue
            if (specifierText.startsWith('.')) {
                const resolved = resolveRelativeTsFile(current, specifierText)
                if (resolved !== null && !visited.has(resolved)) {
                    queue.push(resolved)
                }
            } else {
                externals.add(specifierText)
            }
        }
    }

    return { visitedFiles: [...visited], externals }
}

describe('Pass 59 Audit Prompt & CLI Entry Tree-Shaking Regressions', () => {
    let savedEncKey: string | undefined
    let savedDbEncKey: string | undefined

    beforeEach(() => {
        savedEncKey = process.env['MJ_DB_ENCRYPTION_KEY']
        savedDbEncKey = process.env['DB_ENCRYPTION_KEY']
        delete process.env['MJ_DB_ENCRYPTION_KEY']
        delete process.env['DB_ENCRYPTION_KEY']
    })

    afterEach(() => {
        if (savedEncKey !== undefined) {
            process.env['MJ_DB_ENCRYPTION_KEY'] = savedEncKey
        }
        if (savedDbEncKey !== undefined) {
            process.env['DB_ENCRYPTION_KEY'] = savedDbEncKey
        }
    })

    it('AP1–AP3: bumps AUDIT_PROMPT_REVISION to pass59 and includes bundle-graph, Zod coerce/.origin, and wrapper exit-code guidance', async () => {
        expect(AUDIT_PROMPT_REVISION).toBe('2026-11-24-audit-pass86')

        const dbPath = path.join(
            os.tmpdir(),
            `mj-pass59-prompts-${String(process.pid)}-${String(Date.now())}.db`
        )
        const adapter = new DatabaseAdapter(dbPath, { projectRegistry: {} })
        try {
            await adapter.initialize()

            const perfDef = getPerformanceAuditPromptDefinition()
            const perfRes = await perfDef.handler({ target: 'src', copilot: 'false' }, adapter)
            const perfText = perfRes.messages[0]?.content.text ?? ''
            expect(perfText).toContain('Prompt revision: 2026-11-24-audit-pass86')
            expect(perfText).toContain('AST bundle-graph leaks')
            expect(perfText).toContain('explore')
            expect(perfText).toContain('generalPurpose')

            const cqDef = getCodeQualityAuditPromptDefinition()
            const cqRes = await cqDef.handler({ target: 'src', copilot: 'false' }, adapter)
            const cqText = cqRes.messages[0]?.content.text ?? ''
            expect(cqText).toContain('Prompt revision: 2026-11-24-audit-pass86')
            expect(cqText).toContain('z.coerce.number()')
            expect(cqText).toContain('Number(val)')
            expect(cqText).toContain('.origin')
            expect(cqText).toContain('in-process CLI wrappers')
            expect(cqText).toContain('process.exitCode')
            expect(cqText).not.toMatch(/[A-Z]:\\Users\\/i)
        } finally {
            adapter.close()
            if (fs.existsSync(dbPath)) {
                fs.rmSync(dbPath, { force: true })
            }
        }
    })

    it('P-H1: CLI entry runtime import graph has zero heavy server, git, GitHub, or commander externals', () => {
        const entryFile = path.join(SRC_ROOT, 'cli', 'commands', 'entry.ts')
        const { visitedFiles, externals } = collectRuntimeGraph(entryFile)

        expect(visitedFiles.length).toBeGreaterThan(3)
        for (const forbidden of FORBIDDEN_ENTRY_EXTERNALS) {
            expect(externals.has(forbidden)).toBe(false)
        }
    })
})
