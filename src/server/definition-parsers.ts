import { isRecord } from '../utils/type-guards.js'
import type { PromptDefinition, ResourceDefinition } from './registration.js'

function parseCapabilities(
    raw: unknown
): PromptDefinition['capabilities'] | undefined {
    if (!isRecord(raw)) return undefined
    const caps: NonNullable<PromptDefinition['capabilities']> = {}
    if (typeof raw['requiresTeamScope'] === 'boolean') {
        caps.requiresTeamScope = raw['requiresTeamScope']
    }
    if (typeof raw['requiresAdminScope'] === 'boolean') {
        caps.requiresAdminScope = raw['requiresAdminScope']
    }
    if (typeof raw['requiresAuditScope'] === 'boolean') {
        caps.requiresAuditScope = raw['requiresAuditScope']
    }
    return caps
}

function parseIcons(raw: unknown): PromptDefinition['icons'] | undefined {
    if (!Array.isArray(raw)) return undefined
    const icons: NonNullable<PromptDefinition['icons']> = []
    for (const item of raw) {
        if (!isRecord(item) || typeof item['src'] !== 'string') continue
        const icon: NonNullable<PromptDefinition['icons']>[number] = { src: item['src'] }
        if (typeof item['mimeType'] === 'string') icon.mimeType = item['mimeType']
        if (Array.isArray(item['sizes'])) {
            icon.sizes = item['sizes'].filter((s): s is string => typeof s === 'string')
        }
        icons.push(icon)
    }
    return icons
}

function parsePromptArguments(raw: unknown): PromptDefinition['arguments'] | undefined {
    if (!Array.isArray(raw)) return undefined
    const args: NonNullable<PromptDefinition['arguments']> = []
    for (const item of raw) {
        if (
            !isRecord(item) ||
            typeof item['name'] !== 'string' ||
            typeof item['description'] !== 'string'
        ) {
            continue
        }
        const arg: NonNullable<PromptDefinition['arguments']>[number] = {
            name: item['name'],
            description: item['description'],
        }
        if (typeof item['required'] === 'boolean') arg.required = item['required']
        args.push(arg)
    }
    return args
}

function parseResourceAnnotations(raw: unknown): ResourceDefinition['annotations'] | undefined {
    if (!isRecord(raw)) return undefined
    const ann: NonNullable<ResourceDefinition['annotations']> = {}
    if (Array.isArray(raw['audience'])) {
        ann.audience = raw['audience'].filter(
            (a): a is 'user' | 'assistant' => a === 'user' || a === 'assistant'
        )
    }
    if (typeof raw['priority'] === 'number') ann.priority = raw['priority']
    if (typeof raw['lastModified'] === 'string') ann.lastModified = raw['lastModified']
    if (typeof raw['autoRead'] === 'boolean') ann.autoRead = raw['autoRead']
    if (typeof raw['sessionInit'] === 'boolean') ann.sessionInit = raw['sessionInit']
    return ann
}

/** Narrow raw prompt definitions from `getPrompts()` into typed `PromptDefinition[]`. */
export function toPromptDefinitions(raw: readonly unknown[]): PromptDefinition[] {
    const out: PromptDefinition[] = []
    for (const item of raw) {
        if (!isRecord(item) || typeof item['name'] !== 'string') continue
        const def: PromptDefinition = { name: item['name'] }
        if (typeof item['description'] === 'string') def.description = item['description']
        const args = parsePromptArguments(item['arguments'])
        if (args !== undefined) def.arguments = args
        const icons = parseIcons(item['icons'])
        if (icons !== undefined) def.icons = icons
        const caps = parseCapabilities(item['capabilities'])
        if (caps !== undefined) def.capabilities = caps
        out.push(def)
    }
    return out
}

/** Narrow raw resource definitions from `getResources()` into typed `ResourceDefinition[]`. */
export function toResourceDefinitions(raw: readonly unknown[]): ResourceDefinition[] {
    const out: ResourceDefinition[] = []
    for (const item of raw) {
        if (
            !isRecord(item) ||
            typeof item['uri'] !== 'string' ||
            typeof item['name'] !== 'string'
        ) {
            continue
        }
        const def: ResourceDefinition = { uri: item['uri'], name: item['name'] }
        if (typeof item['title'] === 'string') def.title = item['title']
        if (typeof item['description'] === 'string') def.description = item['description']
        if (typeof item['mimeType'] === 'string') def.mimeType = item['mimeType']
        const icons = parseIcons(item['icons'])
        if (icons !== undefined) def.icons = icons
        const annotations = parseResourceAnnotations(item['annotations'])
        if (annotations !== undefined) def.annotations = annotations
        const caps = parseCapabilities(item['capabilities'])
        if (caps !== undefined) def.capabilities = caps
        out.push(def)
    }
    return out
}
