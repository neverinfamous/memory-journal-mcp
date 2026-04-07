import { getTools, callTool } from '../../src/handlers/tools/index.ts'
import { DatabaseAdapterFactory } from '../../src/database/adapter-factory.ts'
import { VectorSearchManager } from '../../src/vector/vector-search-manager.ts'
import { GitHubIntegration } from '../../src/github/github-integration/index.ts'

async function runTests() {
    const db = await DatabaseAdapterFactory.create(':memory:')
    await db.initialize()
    const vectorManager = new VectorSearchManager(db)
    const github = new GitHubIntegration('.')

    let tokenEstimate = 0
    console.log('--- Starting Relationships Tool Group Tests ---')

    const tools = await getTools(db, null, vectorManager, github, {})

    async function testCall(name: string, args: any) {
        try {
            const res: any = await callTool(name, args, db, vectorManager, github, {})
            if (res?._meta?.tokenEstimate) {
                tokenEstimate += res._meta.tokenEstimate
            }
            return res
        } catch (err: any) {
            return { isRawError: true, message: err.message }
        }
    }

    // Set up entries
    const aRes = await testCall('create_entry_minimal', { content: 'Node A' })
    const bRes = await testCall('create_entry_minimal', { content: 'Node B' })
    const cRes = await testCall('create_entry_minimal', { content: 'Node C' })
    const dRes = await testCall('create_entry_minimal', { content: 'Node D' })

    const extractId = (res: any) => {
        if (res.isRawError) return null
        return res.entry?.id || res.id
    }

    const aId = extractId(aRes)
    const bId = extractId(bRes)
    const cId = extractId(cRes)
    const dId = extractId(dRes)

    console.log(`\nCreated Entries A=${aId}, B=${bId}, C=${cId}, D=${dId}`)

    // Test 1: Happy path
    const hpRes = await testCall('link_entries', {
        from_entry_id: aId,
        to_entry_id: bId,
        relationship_type: 'blocks',
        description: 'A blocks B',
    })
    console.log('\n--- Happy Path: link_entries ---')
    console.log(JSON.stringify(hpRes, null, 2))

    // Test 2: Domain Error - invalid relationship_type
    const domErrRes = await testCall('link_entries', {
        from_entry_id: aId,
        to_entry_id: bId,
        relationship_type: 'invalid_relationship',
        description: 'Bad relationship',
    })
    console.log('\n--- Domain Error: invalid relationship_type ---')
    console.log(JSON.stringify(domErrRes, null, 2))

    // Test 3: Duplicate Link
    const dupErrRes = await testCall('link_entries', {
        from_entry_id: aId,
        to_entry_id: bId,
        relationship_type: 'blocks',
        description: 'A blocks B again',
    })
    console.log('\n--- Duplicate Link ---')
    console.log(JSON.stringify(dupErrRes, null, 2))

    // Test 4: Reverse Link
    const revErrRes = await testCall('link_entries', {
        from_entry_id: bId,
        to_entry_id: aId,
        relationship_type: 'depends_on',
        description: 'B depends on A',
    })
    console.log('\n--- Reverse Link ---')
    console.log(JSON.stringify(revErrRes, null, 2))

    // Test 5: Zod Empty Param
    const emptyRes = await testCall('link_entries', {})
    console.log('\n--- Zod Empty Param: link_entries ---')
    console.log(JSON.stringify(emptyRes, null, 2))

    // Test 6: Zod Type mismatch
    const typeRes = await testCall('link_entries', {
        from_entry_id: 'abc',
        to_entry_id: bId,
        relationship_type: 'blocks',
    })
    console.log('\n--- Zod Type Mismatch: link_entries ---')
    console.log(JSON.stringify(typeRes, null, 2))

    // Visualization Setup (A -> B -> C -> D)
    await testCall('link_entries', {
        from_entry_id: bId,
        to_entry_id: cId,
        relationship_type: 'blocks',
    })
    await testCall('link_entries', {
        from_entry_id: cId,
        to_entry_id: dId,
        relationship_type: 'blocks',
    })

    // Test 7: visualize_relationships Depth 1
    const vis1Res = await testCall('visualize_relationships', { entry_id: aId, depth: 1 })
    console.log('\n--- Visualize Relationships: Depth 1 ---')
    console.log(JSON.stringify(vis1Res, null, 2))

    // Test 8: visualize_relationships Depth 3
    const vis3Res = await testCall('visualize_relationships', { entry_id: aId, depth: 3 })
    console.log('\n--- Visualize Relationships: Depth 3 ---')
    console.log(JSON.stringify(vis3Res, null, 2))

    // Test 9: visualize_relationships Domain Error (non-existent)
    const visMissingRes = await testCall('visualize_relationships', {
        entry_id: 99999999,
        depth: 1,
    })
    console.log('\n--- Visualize Relationships: Non-existent ID ---')
    console.log(JSON.stringify(visMissingRes, null, 2))

    // Test 10: visualize_relationships Empty Param
    const visEmptyRes = await testCall('visualize_relationships', {})
    console.log('\n--- Visualize Relationships: Empty Param ---')
    console.log(JSON.stringify(visEmptyRes, null, 2))

    // Test 11: visualize_relationships Type mismatch
    const visTypeRes = await testCall('visualize_relationships', { entry_id: aId, depth: 'abc' })
    console.log('\n--- Visualize Relationships: Type Mismatch ---')
    console.log(JSON.stringify(visTypeRes, null, 2))

    console.log(
        `\n==============\nTotal Token Estimate (Test Script): ${tokenEstimate}\n==============`
    )
    await db.close()
}

runTests().catch(console.error)
