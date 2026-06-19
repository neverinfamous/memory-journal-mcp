import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { healAgentHallucinations } from '../src/handlers/tools/schemas.js';

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
        const healed = healAgentHallucinations(payload) as any;
        expect(healed.auto_context).toBeUndefined();
    });
});
