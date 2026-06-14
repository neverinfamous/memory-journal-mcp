import { SearchEntriesSchema } from './src/handlers/tools/search/schemas.js';
try {
    const res = SearchEntriesSchema.parse({ tags: 'test' });
    console.log('Schema parse success:', res);
} catch (e) {
    console.error('Schema parse failed:', e.message);
}
