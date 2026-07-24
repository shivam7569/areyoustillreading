import { OGImageRoute } from 'astro-og-canvas';
import { getCollection } from 'astro:content';

// Generate a social-share PNG per blog post at /og/<id>.png (build time).
const posts = await getCollection('blog', ({ data }) => !data.draft);
const pages = Object.fromEntries(posts.map((post) => [post.id, post.data]));

export const { getStaticPaths, GET } = await OGImageRoute({
  pages,
  getImageOptions: (_path, page) => ({
    title: page.title,
    description: page.description,
    bgGradient: [
      [15, 17, 21],
      [23, 26, 33],
    ],
    border: { color: [47, 91, 255], width: 12, side: 'inline-start' },
    padding: 72,
  }),
});
