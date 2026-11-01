/**
 * Prompt Handler Tests
 *
 * Tests the prompt listing and execution handlers.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getPrompts, getPrompt } from '../../src/handlers/prompts/index.js'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'

describe('Prompt Handlers', () => {
    let db: DatabaseAdapter
    let teamDb: DatabaseAdapter
    const testDbPath = './.test-output/vitest/test-prompts.db'
    const testTeamDbPath = './.test-output/vitest/test-team-prompts.db'

    beforeAll(async () => {
        db = new DatabaseAdapter(testDbPath)
        await db.initialize()
        // Seed some data for prompts that read from the DB
        db.createEntry({ content: 'Test entry for prompts', tags: ['test-tag'] })

        // Seed GitHub prompt relevant entries (prNumber, projectNumber, workflowRunId)
        db.createEntry({
            content:
                'PR entry with very long content to trigger truncation in formatPromptEntries. '.repeat(
                    10
                ),
            prNumber: 42,
        })
        db.createEntry({
            content: 'Project entry',
            projectNumber: 42,
            significanceType: 'milestone',
        })
        db.createEntry({ content: 'Workflow entry', workflowRunId: 101 })

        // Seed Analytics Snapshot to trigger buildDigestSignalForPrompt coverage
        if (typeof db.saveAnalyticsSnapshot === 'function') {
            db.saveAnalyticsSnapshot('digest', {
                activityGrowthPercent: 120,
                currentPeriodEntries: 10,
                significanceMultiplier: 2.0,
                currentPeriodSignificant: 5,
                staleProjects: [{ projectNumber: 99, daysSilent: 45 }],
            })
        }

        teamDb = new DatabaseAdapter(testTeamDbPath)
        await teamDb.initialize()
        teamDb.applyTeamSchema()
        teamDb.createEntry({ content: 'Team test entry', tags: ['team'] })
    })

    afterAll(() => {
        db.close()
        teamDb.close()
        try {
            const fs = require('node:fs')
            if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath)
            if (fs.existsSync(testTeamDbPath)) fs.unlinkSync(testTeamDbPath)
        } catch {
            // Ignore cleanup errors
        }
    })

    // ========================================================================
    // getPrompts
    // ========================================================================

    describe('getPrompts', () => {
        it('should return an array of prompt definitions', () => {
            const prompts = getPrompts()
            expect(Array.isArray(prompts)).toBe(true)
            expect(prompts.length).toBeGreaterThan(0)
        })

        it('should have name and description on each prompt', () => {
            const prompts = getPrompts()
            for (const prompt of prompts) {
                const p = prompt as { name: string; description: string }
                expect(typeof p.name).toBe('string')
                expect(p.name.length).toBeGreaterThan(0)
                expect(typeof p.description).toBe('string')
            }
        })

        it('should include known prompt names', () => {
            const prompts = getPrompts()
            const names = prompts.map((p) => (p as { name: string }).name)

            // At least some expected prompts should be present
            expect(names.length).toBeGreaterThan(5)
        })
    })

    // ========================================================================
    // getPrompt
    // ========================================================================

    describe('getPrompt', () => {
        it('should return messages for each known prompt', async () => {
            const prompts = getPrompts()
            const names = prompts.map((p) => (p as { name: string }).name)

            for (const name of names) {
                const result = await getPrompt(
                    name,
                    { pr_number: '42', project_number: '42' },
                    db,
                    teamDb
                )
                expect(result.messages).toBeDefined()
                expect(Array.isArray(result.messages)).toBe(true)
                expect(result.messages.length).toBeGreaterThan(0)

                // Each message should have role and content
                for (const msg of result.messages) {
                    expect(msg.role).toBeDefined()
                    expect(msg.content).toBeDefined()
                }
            }
        })

        it('should throw for unknown prompt name', () => {
            expect(() => getPrompt('nonexistent_prompt_xyz', {}, db)).toThrow()
        })

        it('should return messages for prepare-standup', async () => {
            const result = await getPrompt('prepare-standup', {}, db)

            expect(result.messages).toBeDefined()
            expect(result.messages.length).toBeGreaterThan(0)
            const text = (result.messages[0]?.content as { text: string }).text
            expect(text).toContain('standup')
        })

        it('should return messages for goal-tracker prompt', async () => {
            const result = await getPrompt('goal-tracker', {}, db)

            expect(result.messages).toBeDefined()
            expect(result.messages.length).toBeGreaterThan(0)
        })

        it('should return messages for team-session-summary prompt with team target', async () => {
            const result = await getPrompt('team-session-summary', undefined, db, teamDb)

            expect(result.messages).toBeDefined()
            expect(result.messages.length).toBeGreaterThan(0)
            const text = (result.messages[0]?.content as { text: string }).text
            expect(text).toContain('Team test entry')
            expect(text).toContain('memory-journal-mcp entry create --team')
        })

        it('should throw ConfigurationError if teamDb is omitted for team-session-summary', async () => {
            await expect(getPrompt('team-session-summary', undefined, db)).rejects.toThrow(
                'Team database not configured'
            )
        })

        it('should mark gh copilot audit as optional (skip by default) in adversarial prompts', async () => {
            const planResult = await getPrompt(
                'adversarial-plan-review',
                { topic: 'Test Plan' },
                db
            )
            const planText = planResult.messages[0]?.content.text ?? ''
            expect(planText).toContain('**Optional (Skip by default)**')
            expect(planText).toContain("opt-in (`copilot: 'true'`)")

            const auditResult = await getPrompt(
                'adversarial-audit-security',
                { target: 'src/auth' },
                db
            )
            const auditText = auditResult.messages[0]?.content.text ?? ''
            expect(auditText).toContain('**Optional (Skip by default)**')
            expect(auditText).toContain("opt-in (`copilot: 'true'`)")
        })

        it('should instruct direct execution of gh copilot command when copilot: "true" is passed to adversarial prompts', async () => {
            const planResult = await getPrompt(
                'adversarial-plan-review',
                { topic: 'Test Plan', copilot: 'true' },
                db
            )
            const planText = planResult.messages[0]?.content.text ?? ''
            expect(planText).toContain('Run `gh copilot -- -p')
            expect(planText).not.toContain('**Optional (Skip by default)**')

            const auditResult = await getPrompt(
                'adversarial-audit-security',
                { target: 'src/auth', copilot: 'true' },
                db
            )
            const auditText = auditResult.messages[0]?.content.text ?? ''
            expect(auditText).toContain('Run `gh copilot -- -p')
            expect(auditText).not.toContain('**Optional (Skip by default)**')
        })

        it('should support unattended full-depth mode in optimize-journal without interactive stop prompts', async () => {
            const quickRes = await getPrompt('optimize-journal', { mode: 'quick' }, db)
            const quickText = quickRes.messages[0]?.content.text ?? ''
            expect(quickText).toContain('INTERACTIVE HANDOVER FOR COMPREHENSIVE MULTI-AGENT DOMAIN AUDIT')
            expect(quickText).toContain('while (processed < 500)')

            const fullRes = await getPrompt(
                'optimize-journal',
                { mode: 'full', autoRun: 'true', limit: '0' },
                db
            )
            const fullText = fullRes.messages[0]?.content.text ?? ''
            expect(fullText).toContain('UNATTENDED FULL-DEPTH EXECUTION PROTOCOL')
            expect(fullText).toContain('for (let _page = 0; _page < 200; _page++)')
            expect(fullText).not.toContain('INTERACTIVE HANDOVER FOR COMPREHENSIVE MULTI-AGENT DOMAIN AUDIT')
        })

        it('should render cms-rem-supervisor prompt with deleted entry audit and dirty-tree gate instructions', async () => {
            const maintEntry = db.createEntry({
                content: '## CMS-02 Maintenance Report\nCompleted consolidation.',
                entryType: 'maintenance',
                tags: ['database-optimizer', 'cms-02-nrem-consolidation'],
                significanceType: 'milestone',
            })
            expect(maintEntry.entryType).toBe('maintenance')

            const highValDeleted = db.createEntry({
                content: 'Important architectural decision accidentally deleted',
                entryType: 'project_decision',
                significanceType: 'architecture',
                impactScore: 0.85,
            })
            db.deleteEntry(highValDeleted.id, false)

            const supRes = await getPrompt(
                'cms-rem-supervisor',
                { lookbackHours: '24', autoRestore: 'true' },
                db
            )
            const supText = supRes.messages[0]?.content.text ?? ''
            expect(supText).toContain('CMS-04: REM Meta-Cognitive Supervisor')
            expect(supText).toContain('HIGH-VALUE CANDIDATE FOR RESTORE')
            expect(supText).toContain('DIRTY-TREE CONDITIONAL SINGLE-PASS VALIDATION GATE')
        })
    })
})
