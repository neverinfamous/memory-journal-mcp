const fs = require('fs');

// 1. Fix module paths
const filesToFixPath = [
    'src/cli.ts',
    'src/index.ts',
    'src/transports/http/server/index.ts',
    'src/transports/http/server/legacy-sse.ts',
    'src/transports/http/server/stateful.ts',
    'src/transports/http/server/stateless.ts'
];

for (const file of filesToFixPath) {
    if (fs.existsSync(file)) {
        let content = fs.readFileSync(file, 'utf8');
        content = content.replace(/'\.\/server\/mcp-server\.js'/g, "'./server/mcp-server/index.js'");
        content = content.replace(/'\.\.\/\.\.\/\.\.\/server\/mcp-server\.js'/g, "'../../../server/mcp-server/index.js'");
        fs.writeFileSync(file, content);
    }
}

// 2. Fix core.ts unused IDatabaseAdapter
let coreTs = fs.readFileSync('src/server/mcp-server/core.ts', 'utf8');
coreTs = coreTs.replace('export type { IDatabaseAdapter as SqliteAdapter }', '');
fs.writeFileSync('src/server/mcp-server/core.ts', coreTs);

// 3. Fix database-adapter.ts unused vars
let dbAdapter = fs.readFileSync('src/database/sqlite-adapter/database-adapter.ts', 'utf8');
dbAdapter = dbAdapter.replace(/import type { QueryResult } from '.*?';?\n?/g, '');
dbAdapter = dbAdapter.replace(/const vectorOps = .*\n?/g, '');

// Fix return types for the 4 methods in database-adapter.ts
// We use ReturnType<IDatabaseAdapter['method']>
dbAdapter = dbAdapter.replace(
    /executeDataLifecycle\(options:(.*?)\):(.*?)\{/g,
    'executeDataLifecycle(options: $1): ReturnType<IDatabaseAdapter["executeDataLifecycle"]> {'
);
dbAdapter = dbAdapter.replace(
    /getCrossProjectInsights\(options:(.*?)\):(.*?)\{/g,
    'getCrossProjectInsights(options: $1): ReturnType<IDatabaseAdapter["getCrossProjectInsights"]> {'
);
dbAdapter = dbAdapter.replace(
    /visualizeRelationships\(options:(.*?)\):(.*?)\{/g,
    'visualizeRelationships(options: $1): ReturnType<IDatabaseAdapter["visualizeRelationships"]> {'
);
dbAdapter = dbAdapter.replace(
    /getTeamCollaborationMatrix\(options:(.*?)\):(.*?)\{/g,
    'getTeamCollaborationMatrix(options: $1): ReturnType<IDatabaseAdapter["getTeamCollaborationMatrix"]> {'
);
fs.writeFileSync('src/database/sqlite-adapter/database-adapter.ts', dbAdapter);

// 4. Fix tool-registration.ts
let toolReg = fs.readFileSync('src/server/mcp-server/tool-registration.ts', 'utf8');
// Add CallToolResult import
if (!toolReg.includes('CallToolResult')) {
    toolReg = toolReg.replace(
        "import { SubscribeRequestSchema, UnsubscribeRequestSchema } from '@modelcontextprotocol/sdk/types.js'",
        "import { SubscribeRequestSchema, UnsubscribeRequestSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js'"
    );
}

// Fix Promise<unknown> -> Promise<CallToolResult>
toolReg = toolReg.replace(
    'async (args, extra): Promise<unknown> => {',
    'async (args, extra): Promise<CallToolResult> => {'
);

// Fix inputSchema ZodType casting
toolReg = toolReg.replace(
    /toolOptions\.inputSchema = typeof relaxed\.passthrough === 'function'[\s\S]*?\: schema/g,
    `toolOptions.inputSchema = (typeof relaxed.passthrough === 'function' ? relaxed.passthrough() : schema) as z.ZodType`
);
toolReg = toolReg.replace(
    /toolOptions\.inputSchema = schema\n/g,
    `toolOptions.inputSchema = schema as z.ZodType\n`
);

// Fix outputSchema ZodType casting
toolReg = toolReg.replace(
    /toolOptions\.outputSchema = \([\s\S]*?outSchema as \{ passthrough: \(\) => z\.ZodType \}\n[\s\S]*?\)\.passthrough\(\)/g,
    `toolOptions.outputSchema = ((outSchema as { passthrough: () => z.ZodType }).passthrough()) as z.ZodType`
);
toolReg = toolReg.replace(
    /toolOptions\.outputSchema = outSchema\n/g,
    `toolOptions.outputSchema = outSchema as z.ZodType\n`
);

fs.writeFileSync('src/server/mcp-server/tool-registration.ts', toolReg);
