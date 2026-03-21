/**
 * Tool Annotations Invariant Test
 *
 * Structural enforcement: verifies every tool has proper annotations
 * with explicit readOnlyHint and openWorldHint, plus a valid title.
 */

import { describe, it, expect } from 'vitest'
import { getTools } from '../../src/handlers/tools/index.js'
import { DatabaseAdapterFactory } from '../../src/database/adapter-factory.js'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'

describe('Tool Annotations Invariant', () => {
    // Create a temporary database for tool registration
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-invariant-'))
    const dbPath = path.join(tmpDir, 'test-invariants.db')

    let tools: ReturnType<typeof getTools>

    // Build the tool list once
    it('should load all tools', async () => {
        const db = await DatabaseAdapterFactory.create(dbPath)
        await db.initialize()
        tools = getTools(db, null)
        expect(tools.length).toBeGreaterThan(0)
        db.close()
    })

    it('every tool must have annotations', () => {
        for (const tool of tools) {
            expect(
                tool.annotations,
                `Tool "${tool.name}" is missing annotations`
            ).toBeDefined()
        }
    })

    it('every tool must have an explicit readOnlyHint', () => {
        for (const tool of tools) {
            expect(
                tool.annotations?.readOnlyHint,
                `Tool "${tool.name}" is missing readOnlyHint`
            ).toBeDefined()
        }
    })

    it('every tool must have an explicit openWorldHint', () => {
        for (const tool of tools) {
            expect(
                tool.annotations?.openWorldHint,
                `Tool "${tool.name}" is missing openWorldHint`
            ).toBeDefined()
        }
    })

    it('every tool must have a non-empty name', () => {
        for (const tool of tools) {
            expect(tool.name.length).toBeGreaterThan(0)
            expect(tool.name.length).toBeLessThanOrEqual(128)
        }
    })

    it('tool names must be unique', () => {
        const names = tools.map((t) => t.name)
        expect(new Set(names).size).toBe(names.length)
    })

    it('0 tools should be missing openWorldHint', () => {
        const missing = tools.filter(
            (t) => t.annotations?.openWorldHint === undefined
        )
        expect(
            missing.length,
            `Tools missing openWorldHint: ${missing.map((t) => t.name).join(', ')}`
        ).toBe(0)
    })

    it('every tool must have a non-empty title', () => {
        for (const tool of tools) {
            expect(
                tool.title,
                `Tool "${tool.name}" is missing title`
            ).toBeTruthy()
            expect(tool.title!.length).toBeGreaterThan(0)
        }
    })

    // Cleanup
    it('cleanup', () => {
        try {
            fs.rmSync(tmpDir, { recursive: true })
        } catch {
            // Best-effort cleanup
        }
    })
})
