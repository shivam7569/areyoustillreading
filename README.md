# areyoustillreading

Personal site + technical blog. Static-first, built with [Astro](https://astro.build); target host is Cloudflare Pages.

## Stack

- **Astro 7**, static output
- **Blog** via content collections with zod-validated frontmatter
- Build-time **Shiki** syntax highlighting (light/dark), **KaTeX** math, **Mermaid** diagrams (inline SVG, no client JS)
- **RSS** feed + **sitemap** + OpenGraph/Twitter meta
- **Pagefind** client-side search
- **Vitest** tests that assert on the built `dist/` output

## Commands

| Command | Action |
| --- | --- |
| `npm install` | Install dependencies |
| `npm run dev` | Dev server at http://localhost:4321 |
| `npm run build` | Build to `dist/` (also generates the Pagefind index) |
| `npm run preview` | Preview the production build locally |
| `npm test` | Build, then run the Vitest suite |

## Writing a post

Add a Markdown file under `src/content/blog/` (the filename becomes the URL):

```markdown
---
title: "My post"
description: "One-line summary used in listings, RSS, and SEO."
pubDate: 2026-07-24
tags: ["llm"]
draft: false
---

Body in Markdown. Fenced code is syntax-highlighted, inline/display math renders
via KaTeX, and `mermaid` code fences render to inline SVG at build time.
```

`draft: true` hides a post from the listing, RSS, and search. The post publishes at `/blog/<filename>`.

## Notes

- Build-time Mermaid renders via Playwright/Chromium. Locally: `npx playwright install chromium`. Any CI/deploy build must install it too (or switch Mermaid to client-side).
