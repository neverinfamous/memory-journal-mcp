import { z } from 'zod'
import type { ToolDefinition } from '../types/index.js'
import { toolNameToMethodName } from './api.js'

/**
 * Converts a single Zod schema type into a TypeScript string representation.
 */
export function getZodTypeString(schema: unknown): string {
    if (schema instanceof z.ZodString) return 'string'
    if (schema instanceof z.ZodNumber) return 'number'
    if (schema instanceof z.ZodBoolean) return 'boolean'
    
    if (schema instanceof z.ZodArray) {
        return `${getZodTypeString(schema.element)}[]`
    }
    
    if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
        return `${getZodTypeString(schema.unwrap())} | undefined`
    }
    
    if (schema instanceof z.ZodDefault) {
        return getZodTypeString(schema.unwrap())
    }
    
    if (schema instanceof z.ZodUnion) {
        return schema.options.map((o: unknown) => getZodTypeString(o)).join(' | ')
    }
    
    if (schema instanceof z.ZodEnum) {
        return schema.options.map((o: unknown) => `'${String(o)}'`).join(' | ')
    }
    
    if (schema instanceof z.ZodObject) {
        const shape = schema.shape as Record<string, unknown>
        const props = Object.entries(shape).map(([k, v]) => {
            const isOptional = v instanceof z.ZodOptional || v instanceof z.ZodDefault
            return `${k}${isOptional ? '?' : ''}: ${getZodTypeString(v)}`
        })
        return `{ ${props.join(', ')} }`
    }
    
    return 'any'
}

/**
 * Generates a complete .d.ts namespace string for the given tools.
 * Organizes tools into their respective `mj.<group>.<method>` structures.
 */
export function generateTypescriptDeclarations(tools: ToolDefinition[]): string {
    const groups = new Map<string, ToolDefinition[]>()
    
    for (const tool of tools) {
        if (tool.group === 'codemode') continue
        
        const existing = groups.get(tool.group) ?? []
        existing.push(tool)
        groups.set(tool.group, existing)
    }

    let dts = 'declare namespace mj {\n'
    
    for (const [groupName, groupTools] of groups.entries()) {
        dts += `  namespace ${groupName} {\n`
        
        for (const tool of groupTools) {
            const methodName = toolNameToMethodName(tool.name, groupName)
            const paramType = getZodTypeString(tool.inputSchema)
            
            // Add a brief comment if description exists
            if (tool.description) {
                const comment = tool.description.split('\\n')[0]
                dts += `    /** ${comment} */\n`
            }
            dts += `    function ${methodName}(args?: ${paramType}): Promise<any>;\n`
        }
        
        // Add group-level help
        dts += `    function help(): Promise<any>;\n`
        dts += `  }\n`
    }
    
    // Top-level help
    dts += `  function help(): Promise<any>;\n`
    dts += `}\n`
    
    return dts
}
