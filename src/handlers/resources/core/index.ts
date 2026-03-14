import type { InternalResourceDef } from '../shared.js'
import { briefingResource } from './briefing/index.js'
import { instructionsResource } from './instructions.js'
import { healthResource } from './health.js'
import {
    recentResource,
    significantResource,
    tagsResource,
    statisticsResource,
} from './utilities.js'

/**
 * Get core resource definitions
 */
export function getCoreResourceDefinitions(): InternalResourceDef[] {
    return [
        briefingResource,
        instructionsResource,
        recentResource,
        significantResource,
        tagsResource,
        statisticsResource,
        healthResource,
    ]
}
