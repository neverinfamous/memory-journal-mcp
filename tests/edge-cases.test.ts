import { describe, it, expect } from 'vitest';
import {
    CAUSED_BY_RELATIONSHIP_ERROR,
    healAgentHallucinations,
} from '../src/handlers/tools/schemas.js';
import { CreateEntrySchema } from '../src/handlers/tools/core/schemas.js';
import { LinkEntriesSchema, LinkEntriesSchemaMcp } from '../src/handlers/tools/relationship-schemas.js';
import { TeamCreateEntrySchema } from '../src/handlers/tools/team/schemas/core-search-schemas.js';
import { TeamLinkEntriesSchema } from '../src/handlers/tools/team/schemas/analytics-vector-schemas.js';

describe('Anti-Hallucination Edge Cases', () => {
    it('should heal entry_type "team-session-summary" to "retrospective" with "session-summary" tag', () => {
        const payload = {
            entry_type: 'team-session-summary',
            content: 'some content'
        };
        const healed = healAgentHallucinations(payload) as any;
        expect(healed.entry_type).toBe('retrospective');
        expect(healed.tags).toContain('session-summary');
    });

    it('should heal entry_type "team_session_summary" similarly', () => {
        const payload = {
            entry_type: 'team_session_summary',
            content: 'some content'
        };
        const healed = healAgentHallucinations(payload) as any;
        expect(healed.entry_type).toBe('retrospective');
        expect(healed.tags).toContain('session-summary');
    });

    it('should heal tags ["team-session-summary"] to "session-summary"', () => {
        const payload = {
            tags: ['team-session-summary', 'other']
        };
        const healed = healAgentHallucinations(payload) as any;
        expect(healed.tags).toContain('session-summary');
        expect(healed.tags).not.toContain('team-session-summary');
        expect(healed.tags).toContain('other');
    });

    it('should delete auto_context when it is "None"', () => {
        const payload = {
            auto_context: 'None'
        };
        const healed = healAgentHallucinations(payload) as any;
        expect(healed.auto_context).toBeUndefined();
    });

    it('should delete auto_context when it is "{}"', () => {
        const payload = {
            auto_context: '{}'
        };
        const healed = healAgentHallucinations(payload) as any;
        expect(healed.auto_context).toBeUndefined();
    });

    it('should delete auto_context when it is {"commits":[]}', () => {
        const payload = {
            auto_context: '{"commits":[]}'
        };
        const healed = healAgentHallucinations(payload) as Record<string, unknown>;
        expect(healed['auto_context']).toBeUndefined();
    });

    it('should delete whitespace-padded and single-quoted empty auto_context strings', () => {
        for (const raw of ['{"commits": []}', ' { "commits" : [ ] } ', "{ 'commits': [] }", ' { } ']) {
            const healed = healAgentHallucinations({ auto_context: raw }) as Record<string, unknown>;
            expect(healed['auto_context']).toBeUndefined();
        }
    });

    it('should preserve auto_context when non-empty commits or extra metadata exist', () => {
        const withCommit = healAgentHallucinations({
            auto_context: '{"commits": ["abc1234"]}',
        }) as Record<string, unknown>;
        expect(withCommit['auto_context']).toBe('{"commits": ["abc1234"]}');

        const withExtra = healAgentHallucinations({
            auto_context: '{"commits": [], "branch": "main"}',
        }) as Record<string, unknown>;
        expect(withExtra['auto_context']).toBe('{"commits": [], "branch": "main"}');
    });

    it('should emit targeted anti-hallucination error for caused_by on personal and team schemas', () => {
        const createRes = CreateEntrySchema.safeParse({
            content: 'Investigated regression',
            relationships: [{ targetId: 42, relationType: 'caused_by' }],
        });
        expect(createRes.success).toBe(false);
        if (!createRes.success) {
            expect(createRes.error.issues[0]?.message).toBe(CAUSED_BY_RELATIONSHIP_ERROR);
        }

        const topLevelRes = CreateEntrySchema.safeParse({
            content: 'Investigated regression',
            caused_by: 42,
        });
        expect(topLevelRes.success).toBe(false);
        if (!topLevelRes.success) {
            expect(topLevelRes.error.issues[0]?.message).toBe(CAUSED_BY_RELATIONSHIP_ERROR);
        }

        const linkRes = LinkEntriesSchema.safeParse(
            LinkEntriesSchemaMcp.parse({
                from_entry_id: 10,
                to_entry_id: 20,
                relationship_type: 'causedBy',
            })
        );
        expect(linkRes.success).toBe(false);
        if (!linkRes.success) {
            expect(linkRes.error.issues[0]?.message).toBe(CAUSED_BY_RELATIONSHIP_ERROR);
        }

        const teamCreateRes = TeamCreateEntrySchema.safeParse({
            content: 'Team entry',
            relationships: [{ targetId: 7, relationType: 'caused-by' }],
        });
        expect(teamCreateRes.success).toBe(false);
        if (!teamCreateRes.success) {
            expect(teamCreateRes.error.issues[0]?.message).toBe(CAUSED_BY_RELATIONSHIP_ERROR);
        }

        const teamLinkRes = TeamLinkEntriesSchema.safeParse({
            from_entry_id: 1,
            to_entry_id: 2,
            relationship_type: 'caused_by',
        });
        expect(teamLinkRes.success).toBe(false);
        if (!teamLinkRes.success) {
            expect(teamLinkRes.error.issues[0]?.message).toBe(CAUSED_BY_RELATIONSHIP_ERROR);
        }
    });
});
