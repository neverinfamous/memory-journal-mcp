import { sanitizeErrorForLogging } from '../../utils/security-utils.js'

/** Scrub sensitive tokens, keys, and credentials from an error before printing to stderr. */
export function formatCliError(error: unknown): string {
    const raw = error instanceof Error ? error.message : String(error)
    return sanitizeErrorForLogging(raw)
}

/** Print a JSON payload, or a one-line summary when the caller passed `--no-json`. */
export function writeCliResult(value: unknown, json: boolean | undefined, plainText: string): void {
    if (json === false) {
        process.stdout.write(plainText.endsWith('\n') ? plainText : `${plainText}\n`)
        return
    }
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}
