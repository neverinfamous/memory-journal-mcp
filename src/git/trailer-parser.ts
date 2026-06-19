export function parseTrailers(body: string): Record<string, string> {
    const trailers: Record<string, string> = {};
    if (!body) return trailers;
    
    const lines = body.split('\n');
    for (const line of lines) {
        const match = /^([a-zA-Z-]+):\s*(.*)$/.exec(line);
        if (match?.[1] !== undefined && match?.[2] !== undefined) {
            trailers[match[1]] = match[2];
        }
    }
    return trailers;
}
