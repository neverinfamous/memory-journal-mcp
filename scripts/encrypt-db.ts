import Database from 'better-sqlite3'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { parseArgs } from 'node:util'

const { values } = parseArgs({
    options: {
        in: { type: 'string' },
        out: { type: 'string' },
        key: { type: 'string' },
    },
})

const inPath = values.in
const outPath = values.out
const key = values.key || process.env['DB_ENCRYPTION_KEY']

if (!inPath || !outPath || !key) {
    console.error('Usage: npm run encrypt-db -- --in <plaintext.db> --out <encrypted.db> [--key <secret>]')
    console.error('If --key is omitted, DB_ENCRYPTION_KEY environment variable will be used.')
    process.exit(1)
}

if (!fs.existsSync(inPath)) {
    console.error(`Input database not found: ${inPath}`)
    process.exit(1)
}

if (fs.existsSync(outPath)) {
    console.error(`Output database already exists: ${outPath}`)
    process.exit(1)
}

console.log(`Encrypting ${inPath} -> ${outPath}...`)

try {
    // SQLite3 Multiple Ciphers uses PRAGMA rekey for in-place encryption
    // So we copy the database, open the copy, and apply the rekey PRAGMA.
    fs.copyFileSync(inPath, outPath)
    
    const db = new Database(outPath)
    
    // Perform the encryption in-place on the copy
    db.pragma(`rekey = '${key}'`)
    
    // Close to save
    db.close()
    
    console.log('✅ Database encrypted successfully.')
    console.log(`To use it, start the server with DB_ENCRYPTION_KEY=${key}`)
    console.log(`and point the database configuration to ${outPath}.`)
} catch (error) {
    console.error('❌ Failed to encrypt database:', error)
    if (fs.existsSync(outPath)) {
        try {
            fs.unlinkSync(outPath)
            console.log(`Cleaned up partial output file: ${outPath}`)
        } catch (e) {
            // ignore
        }
    }
    process.exit(1)
}
