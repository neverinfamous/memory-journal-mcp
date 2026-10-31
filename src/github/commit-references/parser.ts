export type ReferenceAction = 'fixes' | 'closes' | 'resolves' | 'none'

export interface CommitReference {
    raw: string
    number: number
    owner?: string
    repo?: string
    action: ReferenceAction
}

export function parseCommitReferences(message: string): CommitReference[] {
    const refs: CommitReference[] = []
    const seen = new Set<string>()

    const regex =
        /(?:(?<action>fixes|closes|resolves)\s+)?(?:(?<owner>[\w-]+)\/(?<repo>[\w.-]+))?(?:#|GH-)(?<number>\d+)/gi

    let match
    while ((match = regex.exec(message)) !== null) {
        if (!match.groups) continue

        const actionStr = match.groups['action']?.toLowerCase()
        const action: ReferenceAction =
            actionStr === 'fixes' || actionStr === 'closes' || actionStr === 'resolves'
                ? actionStr
                : 'none'

        const owner = match.groups['owner']
        const repo = match.groups['repo']
        const numberStr = match.groups['number']
        const number = numberStr ? parseInt(numberStr, 10) : NaN
        const raw = match[0].trim()

        const uniqueKey = `${owner ?? ''}/${repo ?? ''}#${number}`
        if (seen.has(uniqueKey)) continue
        seen.add(uniqueKey)

        refs.push({
            raw,
            number,
            owner,
            repo,
            action,
        })
    }

    return refs
}
