async function test() {
    const url = 'http://localhost:5050/mcp'
    const sidRes = await fetch(url + '/session', { method: 'POST' })
    const sessionId = sidRes.headers.get('x-mcp-session-id')
    console.log('Session:', sessionId)

    console.log('Testing 50,000 chars...')
    const res1 = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: {
                name: 'create_entry',
                arguments: { project_number: 5, content: 'A'.repeat(50000) },
            },
        }),
    })
    console.log('50k status:', res1.status, await res1.text())

    console.log('Testing 100,001 chars...')
    const res2 = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/call',
            params: {
                name: 'create_entry',
                arguments: { project_number: 5, content: 'A'.repeat(100001) },
            },
        }),
    })
    console.log('100k status:', res2.status, await res2.text())
}
test()
