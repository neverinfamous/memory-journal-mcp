/**
 * Type declarations for sql.js (WASM-based SQLite)
 */

declare module 'sql.js' {
    export type SqlValue = Record<string, unknown>;

    export interface QueryExecResult {
        columns: string[];
        values: unknown[][];
    }

    export type ParamsObject = Record<string, unknown>;

    export type BindParams = unknown[] | ParamsObject | null;

    export interface Database {
        run(sql: string, params?: BindParams): void;
        exec(sql: string, params?: BindParams): QueryExecResult[];
        each(sql: string, params: BindParams, callback: (row: Record<string, unknown>) => void): void;
        export(): Uint8Array;
        close(): void;
    }

    export interface SqlJsStatic {
        Database: new (data?: ArrayLike<number>) => Database;
    }

    export interface InitSqlJsOptions {
        locateFile?: (filename: string) => string;
    }

    export default function initSqlJs(options?: InitSqlJsOptions): Promise<SqlJsStatic>;
}
