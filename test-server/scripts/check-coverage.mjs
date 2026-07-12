import fs from 'fs';

const ssot = fs.readFileSync('C:\\Users\\chris\\.gemini\\antigravity\\brain\\daf6d3e9-c680-4057-b48b-fb7ea3b403bd\\scratch\\ssot-mapping.md', 'utf8');
const toolMap = JSON.parse(fs.readFileSync('c:\\Users\\chris\\Desktop\\memory-journal-mcp\\test-server\\scripts\\tool-map.json', 'utf8'));

const ssotTools = new Set();
for (const line of ssot.split('\n')) {
    if (line.startsWith('- **')) {
        const parts = line.split(':');
        if (parts.length > 1) {
            const tools = parts[1].match(/`([^`]+)`/g);
            if (tools) {
                for (const t of tools) {
                    ssotTools.add(t.replace(/`/g, ''));
                }
            }
        }
    }
}

const mapTools = new Set(Object.keys(toolMap.toolMap));

console.log('Total SSoT tools:', ssotTools.size);
console.log('Total map tools:', mapTools.size);

const missingInMap = [...ssotTools].filter(t => !mapTools.has(t));
const missingInSSoT = [...mapTools].filter(t => !ssotTools.has(t));

console.log('Missing in tool-map.json (needs to be added to tests):', missingInMap);
console.log('Extra in tool-map.json (not in SSoT):', missingInSSoT);

// Check if any tool has no usability tests
const usabilityMissing = [];
for (const [tool, files] of Object.entries(toolMap.toolMap)) {
    if (tool === 'mj_execute_code') continue;
    const hasUsability = files.some(f => f.startsWith('test-usability-'));
    if (!hasUsability) {
        usabilityMissing.push(tool);
    }
}
console.log('Tools missing usability test files:', usabilityMissing);
