import { z } from 'zod';

const CreateEntrySchemaMcp = z.preprocess(
    (val: unknown) => val,
    z.object({
        entry_type: z.string().optional(),
        content: z.string().optional(),
        project_number: z.number()
    }).strict()
);

console.log(JSON.stringify((CreateEntrySchemaMcp as any)._def, null, 2));
