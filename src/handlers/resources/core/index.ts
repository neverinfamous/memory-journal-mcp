import type { InternalResourceDef } from '../shared.js'
import { getBriefingResource } from './briefing/index.js'
import { getInstructionsResource } from './instructions.js'
import { getStatsResources } from './stats.js'

export function getCoreResourceDefinitions(): InternalResourceDef[] {
    return [
        getBriefingResource(),
        getInstructionsResource(),
        ...getStatsResources()
    ]
}
