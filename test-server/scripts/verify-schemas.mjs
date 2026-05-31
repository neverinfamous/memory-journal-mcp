import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, '../../dist/cli.js');

async function verify() {
    const transport = new StdioClientTransport({
        command: 'node',
        args: [cliPath]
    });
    
    const client = new Client({
        name: 'test-client',
        version: '1.0.0'
    }, {
        capabilities: {}
    });
    
    await client.connect(transport);
    
    const { tools } = await client.listTools();
    
    // Check if tools have the non-standard outputSchema property
    const missing = tools
        .filter(t => t.name !== 'mj_execute_code' && !('outputSchema' in t))
        .map(t => t.name);
    
    if (missing.length === 0) {
        console.log(`SUCCESS: All ${tools.length - 1} standard tools have outputSchema defined on the protocol level.`);
        process.exit(0);
    } else {
        console.error(`FAILED: The following tools are missing outputSchema:`, missing);
        process.exit(1);
    }
}

verify().catch(err => {
    console.error(err);
    process.exit(1);
});
