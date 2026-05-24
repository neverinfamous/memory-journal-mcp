import type { InternalResourceDef } from '../shared.js'
import {
    briefingResource,
    dynamicBriefingResource,
    briefingMessageResource,
    dynamicBriefingMessageResource,
} from './briefing/index.js'
import { instructionsResource } from './instructions.js'
import { healthResource } from './health.js'
import {
    recentResource,
    significantResource,
    tagsResource,
    statisticsResource,
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
        briefingMessageResource,
        dynamicBriefingMessageResource,
        instructionsResource,
        recentResource,
        significantResource,
        tagsResource,
        statisticsResource,
        rulesResource,
        workflowsResource,
        skillsResource,
        healthResource,
        ...getMetricsResourceDefinitions(),
    ]
}
