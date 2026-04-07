import { getTools, callTool } from '../../src/handlers/tools/index.ts'
import { DatabaseAdapterFactory } from '../../src/database/adapter-factory.ts'
import { VectorSearchManager } from '../../src/vector/vector-search-manager.ts'
import { GitHubIntegration } from '../../src/github/github-integration/index.ts'

;(async () => {
    const db = await DatabaseAdapterFactory.create(':memory:')
    await db.initialize()

    // Simulate NO token environments by unsetting process.env
    delete process.env.GITHUB_TOKEN
    const github = new GitHubIntegration('.')
    console.log('API Available?', github.isApiAvailable())

    const vectorManager = new VectorSearchManager(db)
    try {
        const result = await callTool(
            'get_github_issue',
            { issue_number: 1 },
            db,
            vectorManager,
            github,
            {}
        )
        console.log(JSON.stringify(result, null, 2))
    } catch (e) {
        console.error(e)
    }
    await db.close()
    process.exit(0)
})()
