import type { IDatabaseAdapter } from './core/interfaces.js'
import { WasmSqliteAdapter } from './sqlite-adapter/index.js'
import { NativeSqliteAdapter } from './sqlite-native/index.js'
import { logger } from '../utils/logger.js'

export const DatabaseAdapterFactory = {
    /**
     * Creates and returns the appropriate SQLite database adapter
     */
    create(dbPath: string, useNative: boolean): IDatabaseAdapter {
        if (useNative) {
            logger.info('Initializing Native SQLite database backend', { module: 'DatabaseAdapterFactory', dbPath })
            return new NativeSqliteAdapter(dbPath)
        } else {
            logger.info('Initializing WASM (sql.js) database backend', { module: 'DatabaseAdapterFactory', dbPath })
            return new WasmSqliteAdapter(dbPath)
        }
    }
}
