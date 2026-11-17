/** Print a JSON payload, or a one-line summary when the caller passed `--no-json`. */
export function writeCliResult(value: unknown, json: boolean | undefined, plainText: string): void {
    if (json === false) {
        process.stdout.write(plainText.endsWith('\n') ? plainText : `${plainText}\n`)
        return
    }
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}
