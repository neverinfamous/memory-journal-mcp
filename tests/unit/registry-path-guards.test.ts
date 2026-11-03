import { afterEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { Command } from 'commander'
import { assertAdditionalTeamDbIsNotSymlink, buildServerOptions } from '../../src/cli/server-options-builder.js'
import { projectCreateAction } from '../../src/cli/commands/project.js'
import { createRegisterProjectFn } from '../../src/codemode/api/project-registry-ops.js'
import { ConfigResolver } from '../../src/utils/config-resolver.js'

describe('registry and additional team db guards', () => {
    let tmpDir = ''
    const previousConfig = process.env['MEMORY_JOURNAL_CONFIG']
    const previousTeamDbs = process.env['ADDITIONAL_TEAM_DBS']

    afterEach(() => {
        if (previousConfig !== undefined) {
            process.env['MEMORY_JOURNAL_CONFIG'] = previousConfig
        } else {
            delete process.env['MEMORY_JOURNAL_CONFIG']
        }
        if (previousTeamDbs !== undefined) {
            process.env['ADDITIONAL_TEAM_DBS'] = previousTeamDbs
        } else {
            delete process.env['ADDITIONAL_TEAM_DBS']
        }
        if (tmpDir !== '') {
            fs.rmSync(tmpDir, { recursive: true, force: true })
            tmpDir = ''
        }
    })

    it('rejects a symlink additional team db and accepts a missing path', () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-team-db-'))
        const linkPath = path.join(tmpDir, 'link.db')
        const missingPath = path.join(tmpDir, 'missing.db')
        const realPath = path.join(tmpDir, 'real.db')
        fs.writeFileSync(realPath, '')

        expect(() =>
            assertAdditionalTeamDbIsNotSymlink(linkPath, () => ({ isSymbolicLink: () => true }))
        ).toThrow(/cannot be a symlink/)
        expect(() =>
            assertAdditionalTeamDbIsNotSymlink(missingPath, () => {
                const missing = new Error('missing')
                throw Object.assign(missing, { code: 'ENOENT' })
            })
        ).not.toThrow()
        expect(() => assertAdditionalTeamDbIsNotSymlink(realPath, (targetPath) => fs.lstatSync(targetPath))).not.toThrow()

        const resolver = new ConfigResolver(new Command(), {})
        process.env['ADDITIONAL_TEAM_DBS'] = JSON.stringify({ team: missingPath })
        const missingErrors: string[] = []
        const missingBuilt = buildServerOptions(resolver, {}, new Command(), missingErrors)
        expect(missingErrors).toEqual([])
        expect(missingBuilt.serverOptions.additionalTeamDbs?.['team']).toBe(path.resolve(missingPath))

        process.env['ADDITIONAL_TEAM_DBS'] = JSON.stringify({ team: realPath })
        const fileErrors: string[] = []
        const fileBuilt = buildServerOptions(resolver, {}, new Command(), fileErrors)
        expect(fileErrors).toEqual([])
        expect(fileBuilt.serverOptions.additionalTeamDbs?.['team']).toBe(path.resolve(realPath))
    })

    it('does not overwrite a truncated registry from the CLI or code mode', async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-registry-'))
        const configPath = path.join(tmpDir, 'registry.json')
        const truncated = '{ "projectRegistry": '
        fs.writeFileSync(configPath, truncated, 'utf-8')

        await expect(
            projectCreateAction(
                'demo',
                { path: path.join(tmpDir, 'demo'), config: configPath, skipInit: true },
                new Command()
            )
        ).rejects.toThrow(/invalid JSON/)
        expect(fs.readFileSync(configPath, 'utf-8')).toBe(truncated)

        process.env['MEMORY_JOURNAL_CONFIG'] = configPath
        const register = createRegisterProjectFn({})
        const result = await register('demo', path.join(tmpDir, 'demo'), 4)
        expect(result.success).toBe(false)
        expect(result.error).toContain('invalid JSON')
        expect(fs.readFileSync(configPath, 'utf-8')).toBe(truncated)
    })
})
