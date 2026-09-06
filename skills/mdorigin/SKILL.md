---
name: mdorigin
description: Build, preview, and deploy markdown-first sites with local preview, Cloudflare bundles, and agent-readable raw markdown routes.
---

# mdorigin

Use this skill when you want to work on a markdown-first publishing site powered by `mdorigin`.

## Install

Global install:

```bash
npm install -g mdorigin
```

Project-local install:

```bash
npm install --save-dev mdorigin
```

## What it covers

- local preview with `mdorigin dev`
- directory index generation with `mdorigin build index`
- search index generation with `mdorigin build search`
- Cloudflare Worker bundle output with `mdorigin build cloudflare`
- external binary deployment flow for Cloudflare Assets + R2
- markdown and HTML route behavior, including `Accept: text/markdown`
- built-in `/sitemap.xml` and `/feed.xml` when `siteUrl` is configured

## Quick commands

```bash
mdorigin dev --root docs/site
mdorigin build index --root docs/site
mdorigin build search --root docs/site
mdorigin build cloudflare --root docs/site
```

External binary deploy flow:

```bash
mdorigin build cloudflare --root docs/site --binary-mode external
mdorigin sync cloudflare-r2 --dir dist/cloudflare --bucket <bucket-name>
mdorigin init cloudflare --dir . --r2-bucket <bucket-name>
```

Cloudflare search deploy flow:

```bash
mdorigin build search --root docs/site --out dist/search
mdorigin build cloudflare --root docs/site --search dist/search --binary-mode external
mdorigin sync cloudflare-r2 --dir dist/cloudflare --bucket <bucket-name>
mdorigin init cloudflare --dir . --r2-bucket <bucket-name>
```

When `build cloudflare` is given `--search`, the search bundle is staged outside `worker.mjs`; larger search files can also require the R2 sync step.

## Remote docs

When an agent needs details, prefer the published docs instead of duplicating everything in the skill:

- HTML docs: `https://mdorigin.holon.run`
- Raw markdown home: `https://mdorigin.holon.run/README.md`
- Routing docs: `https://mdorigin.holon.run/concepts/routing.md`
- Configuration docs: `https://mdorigin.holon.run/reference/configuration.md`
- Extensions docs: `https://mdorigin.holon.run/guides/extensions.md`
- Cloudflare docs: `https://mdorigin.holon.run/guides/cloudflare.md`

Extensionless routes also return markdown when the client sends `Accept: text/markdown`.

## Search

Use search when you need the right doc page before opening it:

- Search API: `https://mdorigin.holon.run/api/search?q=<query>`
- OpenAPI schema: `https://mdorigin.holon.run/api/openapi.json`
- Metadata filters: `/api/search?q=<query>&meta.type=post` or `mdorigin search --index dist/search --meta type=post <query>`
- Repeated local rebuilds can use `mdorigin build search --root docs/site --incremental`
- Site-level search defaults such as `topK`, `mode`, `minScore`, reranker, and score adjustment live in `mdorigin.config.*`; see the configuration docs for details
- Sites can also add optional query-aware search policy rules such as `shortQuery` and `longQuery` in `mdorigin.config.*`

Examples:

```bash
curl 'https://mdorigin.holon.run/api/search?q=cloudflare%20deploy'
curl -H 'Accept: text/markdown' 'https://mdorigin.holon.run/guides/getting-started'
```
