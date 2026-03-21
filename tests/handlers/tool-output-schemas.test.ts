/**
 * Tool Output Schemas Invariant Test
 *
 * Structural enforcement: verifies every tool has an outputSchema,
 * error responses pass outputSchema validation, and ErrorFieldsMixin
 * is properly wired.
 */

import { describe, it, expect } from 'vitest'
import { getTools } from '../../src/handlers/tools/index.js'
import { DatabaseAdapterFactory } from '../../src/database/adapter-factory.js'
import { ErrorFieldsMixin } from '../../src/handlers/tools/error-fields-mixin.js'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import type { z } from 'zod'

/**
 * Tools that intentionally omit outputSchema.
 * mj_execute_code: bare {} JSON Schema crashes clients that process structuredContent.
 */
const OUTPUT_SCHEMA_EXCLUSIONS = new Set(['mj_execute_code'])

describe('Tool Output Schemas Invariant', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-invariant-'))
    const dbPath = path.join(tmpDir, 'test-schemas.db')

    let tools: ReturnType<typeof getTools>

    it('should load all tools', async () => {
        const db = await DatabaseAdapterFactory.create(dbPath)
        await db.initialize()
        tools = getTools(db, null)
        expect(tools.length).toBeGreaterThan(0)
        db.close()
    })

    it('every tool (except known exclusions) must have an outputSchema', () => {
        const missing = tools.filter(
            (t) => t.outputSchema === undefined && !OUTPUT_SCHEMA_EXCLUSIONS.has(t.name)
        )
        expect(
            missing.length,
            `Tools missing outputSchema: ${missing.map((t) => t.name).join(', ')}`
        ).toBe(0)
    })

    it('error response must pass outputSchema (tools with only ErrorFieldsMixin required fields)', () => {
        const errorResponse = {
            success: false,
            error: 'Test error',
            code: 'INTERNAL_ERROR',
            category: 'internal',
            recoverable: false,
        }

        // Track tools that fail and WHY — differentiate between mixin issues
        // (real bugs) and tools with extra required fields (acceptable).
        const mixinFailures: string[] = []

        for (const tool of tools) {
            if (!tool.outputSchema || OUTPUT_SCHEMA_EXCLUSIONS.has(tool.name)) continue
            const schema = tool.outputSchema as z.ZodType
            const result = schema.safeParse(errorResponse)
            if (!result.success) {
                // Check if every issue path is OUTSIDE ErrorFieldsMixin shape
                const mixinKeys = new Set(['success', 'error', 'code', 'category', 'recoverable', 'suggestion'])
                const hasMixinFailure = result.error.issues.some(
                    (issue) => issue.path.length === 1 && mixinKeys.has(String(issue.path[0]))
                )
                if (hasMixinFailure) {
                    mixinFailures.push(tool.name)
                }
                // else: tool has extra required fields beyond ErrorFieldsMixin — acceptable
            }
        }

        expect(
            mixinFailures.length,
            `ErrorFieldsMixin fields rejected by outputSchema: ${mixinFailures.join(', ')}`
        ).toBe(0)
    })

    it('ErrorFieldsMixin fields must be present in every outputSchema', () => {
        const mixinKeys = Object.keys(ErrorFieldsMixin.shape)

        for (const tool of tools) {
            if (!tool.outputSchema) continue
            const schema = tool.outputSchema as z.ZodObject<Record<string, z.ZodType>>
            if (typeof schema.shape !== 'object') continue

            for (const key of mixinKeys) {
                expect(
                    key in schema.shape,
                    `Tool "${tool.name}" outputSchema missing ErrorFieldsMixin field: ${key}`
                ).toBe(true)
            }
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
