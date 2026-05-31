import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

async function main() {
    const transport = new StdioClientTransport({
        command: 'node',
        args: ['dist/cli.js'],
        stderr: 'pipe',
    })

    transport.onerror = (err) => console.error('Transport Error:', err)
    const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} })
    await client.connect(transport)

    console.log('Testing 50,000 chars...')
    try {
        const res1 = await client.callTool({
            name: 'create_entry',
            arguments: {
                project_number: 5,
                content: 'A'.repeat(50000),
            },
        })
        console.log('50k result:', res1.content[0].text)
    } catch (e) {
        console.log('50k failed:', e.message)
    }

    console.log('Testing 100,001 chars...')
    try {
        const res2 = await client.callTool({
            name: 'create_entry',
            arguments: {
                project_number: 5,
                content: 'A'.repeat(100001),
            },
        })
        console.log('100k result:', res2.content[0].text)
    } catch (e) {
        console.log('100k failed:', e.message)
    }

    await transport.close()
}

main().catch(console.error)
