/**
 * Resource Annotation Presets
 *
 * Centralized annotation presets for MCP resources following
 * MCP 2025-11-25 spec. Use these instead of inline annotation
 * objects to ensure consistency across all resource definitions.
 */

// =============================================================================
// Preset Types
// =============================================================================

interface ResourceAnnotation {
    audience?: ('user' | 'assistant')[]
    priority?: number
    autoRead?: boolean
    sessionInit?: boolean
}

// =============================================================================
// Standard Presets
// =============================================================================

/** Critical state resources (health, schema, activity) — priority 0.9 */
export const HIGH_PRIORITY: ResourceAnnotation = {
    priority: 0.9,
    audience: ['user', 'assistant'],
}

/** Analysis/monitoring resources (stats, indexes) — priority 0.6 */
export const MEDIUM_PRIORITY: ResourceAnnotation = {
    priority: 0.6,
    audience: ['user', 'assistant'],
}

/** Supplementary resources (pool stats, extension status) — priority 0.4 */
export const LOW_PRIORITY: ResourceAnnotation = {
    priority: 0.4,
    audience: ['user', 'assistant'],
}

/** Agent-only resources (capabilities, settings, instructions) — priority 0.5 */
export const ASSISTANT_FOCUSED: ResourceAnnotation = {
    priority: 0.5,
    audience: ['assistant'],
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Create a custom-priority annotation, optionally extending a base preset.
 */
export function withPriority(
    priority: number,
    base: ResourceAnnotation = MEDIUM_PRIORITY
): ResourceAnnotation {
    return { ...base, priority }
}

/**
 * Clone a base annotation with autoRead flag set.
 * Useful for session-init resources that should be auto-read.
 */
export function withAutoRead(base: ResourceAnnotation = HIGH_PRIORITY): ResourceAnnotation {
    return { ...base, autoRead: true }
}

/**
 * Clone a base annotation with sessionInit flag set.
 */
export function withSessionInit(base: ResourceAnnotation = HIGH_PRIORITY): ResourceAnnotation {
    return { ...base, sessionInit: true }
}
