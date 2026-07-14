import * as fs from 'fs';
import * as path from 'path';

const ssotPath = 'C:\\Users\\chris\\.gemini\\antigravity\\brain\\10e488bf-cec0-45e1-ab7b-6e9095ae9a58\\scratch\\ssot-mapping.md';
const codemodeDir = 'C:\\Users\\chris\\Desktop\\memory-journal-mcp\\test-server\\codemode';

const camelToSnake = (str: string) => str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);

function parseSSoT() {
    const content = fs.readFileSync(ssotPath, 'utf8');
    const lines = content.split('\n');
    const mapping: Record<string, string[]> = {};
    let currentGroup = '';

    for (const line of lines) {
        const groupMatch = line.match(/^###\s+(\w+)/);
        if (groupMatch) {
            currentGroup = groupMatch[1].trim();
            mapping[currentGroup] = [];
            continue;
        }

        const toolMatch = line.match(/^-\s+(\w+)/);
        if (toolMatch && currentGroup) {
            mapping[currentGroup].push(toolMatch[1].trim());
        }
    }
    return mapping;
}

function extractMjCalls(content: string) {
    const calls = [...content.matchAll(/mj\.(\w+)\.(\w+)/g)];
    const uniqueCalls = new Set<string>();
    calls.forEach(match => {
        const group = match[1];
        const tool = match[2];
        if (tool !== 'help' && group !== 'help') {
            uniqueCalls.add(`${group}.${camelToSnake(tool)}`);
        }
    });
    return Array.from(uniqueCalls);
}

const ssot = parseSSoT();
const allToolsInSSoT = new Set<string>();
for (const [group, tools] of Object.entries(ssot)) {
    for (const tool of tools) {
        allToolsInSSoT.add(`${group}.${tool}`);
    }
}

const testFiles = fs.readdirSync(codemodeDir).filter(f => 
    f.startsWith('test-cm-error') || 
    f.startsWith('test-cm-github') || 
    f.startsWith('test-cm-sandbox') || 
    f === 'test-cm-io.md' || 
    f === 'test-cm-kanban-lifecycle.md' || 
    f === 'test-cm-orchestration.md' || 
    f.startsWith('test-cm-payload') || 
    f === 'test-cm-readonly.md' || 
    f === 'test-cm-relationships.md'
);

const allUsedTools = new Set<string>();

for (const file of testFiles) {
    const content = fs.readFileSync(path.join(codemodeDir, file), 'utf8');
    const calls = extractMjCalls(content);
    
    // Some test prompts specify tools without code blocks, just as text like `get_something`
    const toolsMentioned = [...content.matchAll(/`(\w+_\w+)`/g)].map(m => m[1]);
    
    const fileUsedTools = new Set<string>();
    
    calls.forEach(c => {
        fileUsedTools.add(c);
        allUsedTools.add(c);
    });
    
    for (const t of toolsMentioned) {
        // Try to match it to a group
        for (const [group, tools] of Object.entries(ssot)) {
            if (tools.includes(t)) {
                allUsedTools.add(`${group}.${t}`);
                fileUsedTools.add(`${group}.${t}`);
            }
        }
    }
    
    const hallucinations = Array.from(fileUsedTools).filter(call => {
        const [group, tool] = call.split('.');
        return !ssot[group] || !ssot[group].includes(tool);
    });
    
    if (hallucinations.length > 0) {
        console.log(`${file} hallucinations:`, hallucinations);
    }
}

// Find Gaps (In SSoT but not tested)
const gaps = Array.from(allToolsInSSoT).filter(t => !allUsedTools.has(t));

// Filter SSoT tools that might be tested in OTHER test prompts (e.g. test-cm-admin, test-cm-team)
// The prompt only asked to audit a specific list of test files. 
// "audit test-server/codemode files starting with 'test-cm-error', 'test-cm-github', 'test-cm-sandbox', 'test-cm-io', 'test-cm-kanban', 'test-cm-orchestration', 'test-cm-payload', 'test-cm-readonly', 'test-cm-relationships' against SSoT... Check if test prompts perfectly match the tools they are supposed to test."

console.log(`\nTools tested: ${allUsedTools.size}`);
console.log(`Tools missing from THESE test prompts:`, gaps);

// Let's also parse the server instructions to check for hallucinations/drift specifically.
const instructionsDir = 'C:\\Users\\chris\\Desktop\\memory-journal-mcp\\src\\constants\\instructions\\markdown';
const instructionFiles = fs.readdirSync(instructionsDir).filter(f => f.endsWith('.md'));
for (const file of instructionFiles) {
    const content = fs.readFileSync(path.join(instructionsDir, file), 'utf8');
    const toolsMentioned = [...content.matchAll(/`(\w+_\w+)`/g)].map(m => m[1]);
    const setTools = new Set(toolsMentioned);
    
    const flatSSoTTools = new Set(Object.values(ssot).flat());
    const potentialDrift = Array.from(setTools).filter(t => !flatSSoTTools.has(t));
    if (potentialDrift.length > 0) {
         console.log(`[Instruction] ${file} potential tool drift:`, potentialDrift);
    }
}
