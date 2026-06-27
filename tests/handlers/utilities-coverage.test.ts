import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
    rulesResource,
    workflowsResource,
} from '../../src/handlers/resources/core/utilities.js'
import * as fs from 'node:fs'

describe('utilities coverage', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
    })

    it('covers rulesResource stat checks and caching', async () => {
        const previousRulesFilePath = process.env['RULES_FILE_PATH']
        process.env['RULES_FILE_PATH'] = 'dummy/path'

        try {
            let time = Date.now()
            vi.spyOn(Date, 'now').mockImplementation(() => time)
            const fileMock = {
                stat: vi.fn().mockResolvedValue({ mtimeMs: 1234, size: 100 }),
                readFile: vi.fn().mockResolvedValue('rules content'),
                close: vi.fn().mockResolvedValue(undefined),
            }
            vi.spyOn(fs.promises, 'open').mockResolvedValue(fileMock as any)

            const dummyAllowedContext = {
                briefingConfig: { allowedIoRoots: [process.cwd()] },
            } as any

            // 1. Initial read
            const result = (await rulesResource.handler('mem', dummyAllowedContext)) as any
            expect(result.data).toBe('rules content')

            // 2. Cache hit (advance time by 1ms)
            time += 1
            fileMock.readFile.mockResolvedValue('should not happen')
            const result2 = (await rulesResource.handler('mem', dummyAllowedContext)) as any
            expect(result2.data).toBe('rules content')

            // 3. Error handling (cache expired)
            time += 10 * 60 * 1000
            fileMock.readFile.mockRejectedValue('String error read')
            await expect(rulesResource.handler('mem', dummyAllowedContext)).rejects.toThrow('String error read')
        } finally {
            if (previousRulesFilePath === undefined) {
                delete process.env['RULES_FILE_PATH']
            } else {
                process.env['RULES_FILE_PATH'] = previousRulesFilePath
            }
        }
    })

    it('covers workflowsResource when fallback to process.env is needed', async () => {
        const previousWorkflowSummary = process.env['MEMORY_JOURNAL_WORKFLOW_SUMMARY']
        try {
            process.env['MEMORY_JOURNAL_WORKFLOW_SUMMARY'] = 'test workflow summary'
            const result = workflowsResource.handler('mem', {} as any) as any
            expect(result.data.summary).toBe('test workflow summary')

            delete process.env['MEMORY_JOURNAL_WORKFLOW_SUMMARY']
            expect(() => workflowsResource.handler('mem', {} as any)).toThrow()
        } finally {
            if (previousWorkflowSummary === undefined) {
                delete process.env['MEMORY_JOURNAL_WORKFLOW_SUMMARY']
            } else {
                process.env['MEMORY_JOURNAL_WORKFLOW_SUMMARY'] = previousWorkflowSummary
            }
        }
    })

})
