---
title: "Hello, world"
description: "First post — confirms the Markdown blog pipeline works end to end."
pubDate: 2026-07-24
tags: ["meta"]
---

If you can read this at **/blog/hello-world**, the pipeline works: frontmatter is
validated at build time, Markdown is rendered to HTML, and the post is listed on
the blog index.

## A heading

Body text with a [link](https://astro.build), `inline code`, and a list:

- one
- two
- three

## Math

Inline math such as $E = mc^2$ renders at build time, and so do display blocks:

$$
\int_0^\infty e^{-x}\,dx = 1
$$

## Diagram

Rendered to inline SVG at build time (no client-side JavaScript):

```d2
direction: right
A: Prompt
B: LLM
C: Response
A -> B
B -> C
```

## Code

A fenced code block (syntax-highlighted at build time by Shiki):

```ts
export function greet(name: string): string {
  return `Hello, ${name}`;
}
```
