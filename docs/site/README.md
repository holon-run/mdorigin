---
title: mdorigin
type: page
order: 0
date: 2026-03-20
summary: Markdown-first publishing for human HTML and agent-readable raw markdown.
---

# mdorigin

`mdorigin` is a markdown-first publishing engine for humans and agents.

It keeps markdown directly addressable, renders extensionless HTML from the same files, and can publish the same content tree to local preview or Cloudflare Workers.

If you want to try it quickly, start with [Getting Started](./guides/getting-started.md), then move to [Configuration](./reference/configuration.md), [Extensions](./guides/extensions.md), and [Cloudflare Deployment](./guides/cloudflare.md).

## Core Principle

`mdorigin` is not a template system. Its core is the routing model and the normalized content model built from a markdown tree.

That means:

- `mdorigin` owns routing and content semantics
- default rendering is built in
- advanced users should be able to replace page rendering with code
- extensions should not need to replace the request pipeline itself

In other words, `mdorigin` is a programmable publishing core. A future extension system should let users build their own page layouts, including catalog-style pages, on top of the same routing and content kernel.

## What it does

- filesystem routes map directly to published routes
- `.md` stays accessible as raw source
- `.html` and extensionless routes render the same markdown for humans
- relative assets stay next to content
- the same core works for local Node preview and Cloudflare Workers
- optional search and `/api/search` are powered by `indexbind`
- `indexbind` docs: <https://indexbind.jolestar.workers.dev>

## Project Note

[Why mdorigin exists](./why-mdorigin.md) explains the project direction in one page and gives the shortest rationale for the markdown-first model.

The top navigation and section indexes cover the rest of the documentation.

<!-- INDEX:START -->

- [Guides](./guides/)
  <!-- mdorigin:index kind=directory -->

- [Skills](./skills/)
  <!-- mdorigin:index kind=directory -->

- [Concepts](./concepts/)
  <!-- mdorigin:index kind=directory -->

- [Reference](./reference/)
  <!-- mdorigin:index kind=directory -->

- [Why mdorigin exists](./why-mdorigin.md)
  2026-03-20 · A concise explanation of the markdown-first model and why the project avoids runtime-only content layers.
  <!-- mdorigin:index kind=article -->

<!-- INDEX:END -->
