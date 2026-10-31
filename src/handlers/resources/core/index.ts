import type { InternalResourceDef } from '../shared.js'
import { briefingResource, dynamicBriefingResource } from './briefing/index.js'
import { instructionsResource } from './instructions.js'
import { healthResource } from './health.js'
import {
    recentResource,
    significantResource,
    rulesResource,
    workflowsResource,
    skillsResource,
} from './utilities.js'
import { getMetricsResourceDefinitions } from './metrics-resource.js'

/**
 * Get core resource definitions
 */
export function getCoreResourceDefinitions(): InternalResourceDef[] {
    return [
        briefingResource,
        dynamicBriefingResource,
        instructionsResource,
        recentResource,
        significantResource,
        rulesResource,
        workflowsResource,
        skillsResource,
        healthResource,
        ...getMetricsResourceDefinitions(),
    ]
}
