import Database from 'better-sqlite3'
import * as fs from 'node:fs'
import * as path from 'node:path'

const DB_PATH = path.join(process.cwd(), '.test-output', 'test-encrypted.db')
const ENCRYPTION_KEY = 'super-secret-key-123!'

async function runTests() {
    console.log('--- Starting SQLCipher Encryption Tests ---')

    // Ensure clean state
    if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH)
    if (!fs.existsSync(path.dirname(DB_PATH))) {
        fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })
    }

    try {
        console.log('1. Creating encrypted database...')
        const dbCreate = new Database(DB_PATH)
        // Set key
        dbCreate.pragma(`key = '${ENCRYPTION_KEY}'`)
        
        // Write some data
        dbCreate.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, msg TEXT);')
        dbCreate.exec("INSERT INTO test (msg) VALUES ('Hello Encrypted World!');")
        dbCreate.close()
        console.log('✅ Encrypted database created and data inserted.')

        console.log('2. Attempting to read without a key (should fail)...')
        try {
            const dbFail = new Database(DB_PATH)
            // A simple query to force a read
            dbFail.prepare('SELECT * FROM sqlite_master').get()
            console.error('❌ Failed: Reading without a key succeeded (it should not have).')
            process.exit(1)
        } catch (error) {
            try { dbFail.close() } catch(e){} // prevent EBUSY
            if (error.message.includes('file is not a database')) {
                console.log('✅ Failed successfully with expected "file is not a database" error.')
            } else {
                console.error('❌ Failed: Unexpected error when reading without a key:', error)
                process.exit(1)
            }
        }

        console.log('3. Attempting to read with the correct key (should succeed)...')
        try {
            const dbSuccess = new Database(DB_PATH)
            dbSuccess.pragma(`key = '${ENCRYPTION_KEY}'`)
            const row = dbSuccess.prepare('SELECT * FROM test').get()
            if (row.msg === 'Hello Encrypted World!') {
                console.log('✅ Read successfully. Data matches.')
            } else {
                console.error('❌ Failed: Read succeeded but data is incorrect:', row)
                process.exit(1)
            }
            dbSuccess.close()
        } catch (error) {
            console.error('❌ Failed to read with correct key:', error)
            process.exit(1)
        }

        console.log('--- All encryption tests passed successfully! ---')

    } finally {
        if (fs.existsSync(DB_PATH)) {
            try { fs.unlinkSync(DB_PATH) } catch(e){}
        }
    }
}

runTests().catch(e => {
    console.error('Unhandled error during tests:', e)
    process.exit(1)
})
