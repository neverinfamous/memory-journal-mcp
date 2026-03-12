import * as fs from 'node:fs'
import * as path from 'node:path'
import type { ResourceContext } from '../../shared.js'
import type { SystemBriefingContext } from './types.js'

export function getSystemContext(
    config: NonNullable<ResourceContext['briefingConfig']>
): SystemBriefingContext {
    let rulesFile: SystemBriefingContext['rulesFile'] = undefined
    let skillsDir: SystemBriefingContext['skillsDir'] = undefined

    if (config.rulesFilePath) {
        try {
            const stat = fs.statSync(config.rulesFilePath)
            const now = Date.now()
            const ageMs = now - stat.mtimeMs
            const ageHours = Math.floor(ageMs / 3_600_000)
            const ageDays = Math.floor(ageMs / 86_400_000)
            const agoStr =
                ageDays > 0
                    ? `${String(ageDays)}d ago`
                    : ageHours > 0
                      ? `${String(ageHours)}h ago`
                      : 'just now'
            rulesFile = {
                path: config.rulesFilePath,
                name: path.basename(config.rulesFilePath),
                sizeKB: Math.round(stat.size / 1024),
                lastModified: agoStr,
            }
        } catch {
            // Rules file not found or inaccessible
        }
    }

    if (config.skillsDirPath) {
        try {
            const entries = fs.readdirSync(config.skillsDirPath, {
                withFileTypes: true,
            })
            const skillDirs = entries.filter((e) => e.isDirectory())
            skillsDir = {
                path: config.skillsDirPath,
                count: skillDirs.length,
                names: skillDirs.map((d) => d.name),
            }
        } catch {
            // Skills directory not found or inaccessible
        }
    }

    return { ...(rulesFile ? { rulesFile } : {}), ...(skillsDir ? { skillsDir } : {}) }
}
