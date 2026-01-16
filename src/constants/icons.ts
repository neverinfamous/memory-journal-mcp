/**
 * Memory Journal MCP Server - Icon Constants
 *
 * Centralized icon definitions using data URIs for self-contained distribution.
 * Icons follow MCP 2025-11-25 specification.
 *
 * Using simple Lucide-style SVG icons encoded as data URIs.
 */

import type { McpIcon } from '../types/index.js'

// ============================================================================
// Tool Group Icons
// ============================================================================

/** Journal/notebook icon for core operations */
export const ICON_CORE: McpIcon = {
    src: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"%3E%3Cpath d="M4 19.5A2.5 2.5 0 016.5 17H20"/%3E%3Cpath d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/%3E%3C/svg%3E',
    mimeType: 'image/svg+xml',
    sizes: ['24x24'],
}

/** Magnifying glass for search operations */
export const ICON_SEARCH: McpIcon = {
    src: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"%3E%3Ccircle cx="11" cy="11" r="8"/%3E%3Cline x1="21" y1="21" x2="16.65" y2="16.65"/%3E%3C/svg%3E',
    mimeType: 'image/svg+xml',
    sizes: ['24x24'],
}

/** Chart/bar for analytics */
export const ICON_ANALYTICS: McpIcon = {
    src: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"%3E%3Cline x1="18" y1="20" x2="18" y2="10"/%3E%3Cline x1="12" y1="20" x2="12" y2="4"/%3E%3Cline x1="6" y1="20" x2="6" y2="14"/%3E%3C/svg%3E',
    mimeType: 'image/svg+xml',
    sizes: ['24x24'],
}

/** Link for relationships */
export const ICON_RELATIONSHIPS: McpIcon = {
    src: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"%3E%3Cpath d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/%3E%3Cpath d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/%3E%3C/svg%3E',
    mimeType: 'image/svg+xml',
    sizes: ['24x24'],
}

/** Download/export icon */
export const ICON_EXPORT: McpIcon = {
    src: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"%3E%3Cpath d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/%3E%3Cpolyline points="7 10 12 15 17 10"/%3E%3Cline x1="12" y1="15" x2="12" y2="3"/%3E%3C/svg%3E',
    mimeType: 'image/svg+xml',
    sizes: ['24x24'],
}

/** Settings/cog for admin */
export const ICON_ADMIN: McpIcon = {
    src: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"%3E%3Ccircle cx="12" cy="12" r="3"/%3E%3Cpath d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/%3E%3C/svg%3E',
    mimeType: 'image/svg+xml',
    sizes: ['24x24'],
}

/** GitHub logo for github tools */
export const ICON_GITHUB: McpIcon = {
    src: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"%3E%3Cpath d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/%3E%3C/svg%3E',
    mimeType: 'image/svg+xml',
    sizes: ['24x24'],
}

/** Archive/box for backup */
export const ICON_BACKUP: McpIcon = {
    src: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"%3E%3Cpolyline points="21 8 21 21 3 21 3 8"/%3E%3Crect x="1" y="3" width="22" height="5"/%3E%3Cline x1="10" y1="12" x2="14" y2="12"/%3E%3C/svg%3E',
    mimeType: 'image/svg+xml',
    sizes: ['24x24'],
}

// ============================================================================
// Resource Icons
// ============================================================================

/** Document for briefing/instructions */
export const ICON_BRIEFING: McpIcon = {
    src: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"%3E%3Cpath d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/%3E%3Cpolyline points="14 2 14 8 20 8"/%3E%3Cline x1="16" y1="13" x2="8" y2="13"/%3E%3Cline x1="16" y1="17" x2="8" y2="17"/%3E%3Cpolyline points="10 9 9 9 8 9"/%3E%3C/svg%3E',
    mimeType: 'image/svg+xml',
    sizes: ['24x24'],
}

/** Network/share for graph resources */
export const ICON_GRAPH: McpIcon = {
    src: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"%3E%3Ccircle cx="18" cy="5" r="3"/%3E%3Ccircle cx="6" cy="12" r="3"/%3E%3Ccircle cx="18" cy="19" r="3"/%3E%3Cline x1="8.59" y1="13.51" x2="15.42" y2="17.49"/%3E%3Cline x1="15.41" y1="6.51" x2="8.59" y2="10.49"/%3E%3C/svg%3E',
    mimeType: 'image/svg+xml',
    sizes: ['24x24'],
}

/** Clock for recent/timeline resources */
export const ICON_CLOCK: McpIcon = {
    src: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"%3E%3Ccircle cx="12" cy="12" r="10"/%3E%3Cpolyline points="12 6 12 12 16 14"/%3E%3C/svg%3E',
    mimeType: 'image/svg+xml',
    sizes: ['24x24'],
}

/** Heartbeat for health status */
export const ICON_HEALTH: McpIcon = {
    src: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"%3E%3Cpath d="M22 12h-4l-3 9L9 3l-3 9H2"/%3E%3C/svg%3E',
    mimeType: 'image/svg+xml',
    sizes: ['24x24'],
}

/** Kanban board columns */
export const ICON_KANBAN: McpIcon = {
    src: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"%3E%3Crect x="3" y="3" width="18" height="18" rx="2" ry="2"/%3E%3Cline x1="9" y1="3" x2="9" y2="21"/%3E%3Cline x1="15" y1="3" x2="15" y2="21"/%3E%3C/svg%3E',
    mimeType: 'image/svg+xml',
    sizes: ['24x24'],
}

/** Star for significant items */
export const ICON_STAR: McpIcon = {
    src: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"%3E%3Cpolygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/%3E%3C/svg%3E',
    mimeType: 'image/svg+xml',
    sizes: ['24x24'],
}

/** Tag for tags resource */
export const ICON_TAG: McpIcon = {
    src: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"%3E%3Cpath d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/%3E%3Cline x1="7" y1="7" x2="7.01" y2="7"/%3E%3C/svg%3E',
    mimeType: 'image/svg+xml',
    sizes: ['24x24'],
}

/** Users for team resources */
export const ICON_TEAM: McpIcon = {
    src: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"%3E%3Cpath d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/%3E%3Ccircle cx="9" cy="7" r="4"/%3E%3Cpath d="M23 21v-2a4 4 0 00-3-3.87"/%3E%3Cpath d="M16 3.13a4 4 0 010 7.75"/%3E%3C/svg%3E',
    mimeType: 'image/svg+xml',
    sizes: ['24x24'],
}

/** Issue icon for GitHub issues */
export const ICON_ISSUE: McpIcon = {
    src: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"%3E%3Ccircle cx="12" cy="12" r="10"/%3E%3Cline x1="12" y1="8" x2="12" y2="12"/%3E%3Cline x1="12" y1="16" x2="12.01" y2="16"/%3E%3C/svg%3E',
    mimeType: 'image/svg+xml',
    sizes: ['24x24'],
}

/** Git merge for PR resources */
export const ICON_PR: McpIcon = {
    src: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"%3E%3Ccircle cx="18" cy="18" r="3"/%3E%3Ccircle cx="6" cy="6" r="3"/%3E%3Cpath d="M6 21V9a9 9 0 009 9"/%3E%3C/svg%3E',
    mimeType: 'image/svg+xml',
    sizes: ['24x24'],
}

/** Message bubble for prompts */
export const ICON_PROMPT: McpIcon = {
    src: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"%3E%3Cpath d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/%3E%3C/svg%3E',
    mimeType: 'image/svg+xml',
    sizes: ['24x24'],
}

// ============================================================================
// Tool Group Icon Mapping
// ============================================================================

/** Map tool group name to icon */
export const TOOL_GROUP_ICONS: Record<string, McpIcon> = {
    core: ICON_CORE,
    search: ICON_SEARCH,
    analytics: ICON_ANALYTICS,
    relationships: ICON_RELATIONSHIPS,
    export: ICON_EXPORT,
    admin: ICON_ADMIN,
    github: ICON_GITHUB,
    backup: ICON_BACKUP,
}

/**
 * Get icons array for a tool based on its group
 */
export function getToolIcon(group: string): McpIcon[] | undefined {
    const icon = TOOL_GROUP_ICONS[group]
    return icon ? [icon] : undefined
}
