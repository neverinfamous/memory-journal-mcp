import { getSearchEntriesTool } from './src/handlers/tools/search/search-entries.js';
import { db } from './src/db/index.js'; // mocked or real depending on what is needed
// Let's just import the schema directly and parse it.
import { SearchEntriesSchema } from './src/handlers/tools/search/schemas.js';

try {
    const res = SearchEntriesSchema.parse({ tags: 'test' });
    console.log("Schema parse success:", res);
} catch (e) {
    console.error("Schema parse failed:", e.message);
}
