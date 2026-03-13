import type { IDatabaseAdapter } from './core/interfaces.js'
import { DatabaseAdapter } from './sqlite-adapter/index.js'
import { logger } from '../utils/logger.js'

export const DatabaseAdapterFactory = {
    /**
     * Creates and returns the SQLite database adapter
     */
    create(dbPath: string): Promise<IDatabaseAdapter> {
        logger.info('Initializing SQLite database backend', { module: 'DatabaseAdapterFactory', dbPath })
        return Promise.resolve(new DatabaseAdapter(dbPath))
    }
}
