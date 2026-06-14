import { z } from 'zod';

const schema = z.object({
  tags: z.preprocess((val) => typeof val === 'string' ? [val] : val, z.array(z.string())).optional()
});

console.log(schema.parse({ tags: 'test' }));
console.log(schema.parse({ tags: ['test'] }));
console.log(schema.parse({}));
