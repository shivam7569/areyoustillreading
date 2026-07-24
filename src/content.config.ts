import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
    // Phase 3: a "gateable" post is monetizable — its full body is kept out of the
    // static HTML (served only via the entitlement-checking gate). `preview` is the
    // public teaser shown before unlocking. Non-gateable posts stay fully static.
    gateable: z.boolean().default(false),
    preview: z.string().optional(),
  }),
});

export const collections = { blog };
