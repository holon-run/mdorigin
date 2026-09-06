---
title: Getting Started
order: 10
date: 2026-03-20
summary: Preview content locally, configure a site, and build indexes.
---

# Getting Started

## Quick Start

```bash
npm install -g mdorigin
mdorigin dev --root docs/site
mdorigin build index --root docs/site
```

That is enough to preview a site locally, keep directory indexes up to date, and confirm the content model before touching deployment.

To generate a Worker bundle after that:

```bash
mdorigin build cloudflare --root docs/site
```

`mdorigin` also works well with skill repositories that use `SKILL.md` as the main document file. Those folders are treated as document bundles, while helper directories such as `scripts/` and `references/` stay directly accessible but do not enter automatic indexes.

If your published content lives under `docs/site` but your reusable content lives elsewhere in the repo, you can also expose it with directory symlinks. For example:

```text
docs/site/skills -> ../../skills
```

`mdorigin dev`, `mdorigin build index`, and Cloudflare bundle generation all follow those symlinked directories.

For local retrieval during development, install `indexbind` and build a search bundle:

```bash
npm install indexbind
mdorigin build search --root docs/site
mdorigin search --index dist/search --meta section=guides "cloudflare deploy"
```

`indexbind` documentation:

- Docs: <https://indexbind.jolestar.workers.dev>
- Repository: <https://github.com/holon-run/indexbind>

`build search` now defaults to the higher-quality `model2vec` backend. If you want the smaller legacy fallback instead, run:

```bash
mdorigin build search --root docs/site --embedding-backend hashing
```

To expose the same bundle as a site API during local preview:

```bash
mdorigin dev --root docs/site --search dist/search
```

Available endpoints:

- `/api/search?q=cloudflare+deploy`
- `/api/openapi.json`

You can also filter search by metadata:

```bash
mdorigin search --index dist/search --meta type=post "cloudflare"
curl 'http://localhost:3000/api/search?q=cloudflare&meta.type=post'
```

If you want the site itself to own the default retrieval profile, configure it in `mdorigin.config.*`:

```ts
import { defineConfig } from "mdorigin";

export default defineConfig({
  search: {
    topK: 10,
    mode: "hybrid",
    minScore: 0.05,
    reranker: {
      kind: "embedding-v1",
      candidatePoolSize: 25,
    },
  },
});
```

That profile applies to `mdorigin dev --search ...` and deployed `/api/search` requests. The HTTP API still only accepts `q`, optional `topK`, and `meta.<field>` filters.

If your site needs different retrieval behavior for short queries and longer explanation-style queries, you can add an optional query-aware policy layer:

```ts
import { defineConfig } from "mdorigin";

export default defineConfig({
  search: {
    topK: 10,
    mode: "hybrid",
    policy: {
      shortQuery: {
        maxChars: 6,
        minScore: 0.02,
        reranker: null,
      },
      longQuery: {
        minChars: 12,
        reranker: {
          kind: "heuristic-v1",
          candidatePoolSize: 20,
        },
      },
    },
  },
});
```

`mdorigin` does not enable any dynamic search policy by default. If `search.policy` is absent, the site uses only the static profile.

For repeated local rebuilds, use incremental search indexing:

```bash
mdorigin build search --root docs/site --incremental
```

## Install

```bash
npm install -g mdorigin
```

If you prefer a project-local install, use:

```bash
npm install --save-dev mdorigin
```

## Preview a site

Use a content root such as `docs/site`:

```bash
mdorigin dev --root docs/site
```

That starts a local preview server and serves:

- raw markdown at `/foo.md`
- HTML at `/foo.html`
- default human routes at `/foo`
- markdown on extensionless routes when the client sends `Accept: text/markdown`

For example:

```bash
curl -H "Accept: text/markdown" http://localhost:3000/guides/getting-started
```

## Site config

Create a config file inside the content root, for example `docs/site/mdorigin.config.json` or `docs/site/mdorigin.config.ts`.

If no config file is present, `mdorigin` falls back to the root homepage frontmatter:

- `title` becomes the default site title
- `summary` becomes the default site description

If `stylesheet` is set, the CSS file is read and inlined into rendered HTML for both local preview and Cloudflare bundles. By default the loader prefers:

1. `--config`
2. `<content-root>/mdorigin.config.ts`, `.mjs`, `.js`, or `.json`
3. current working directory `mdorigin.config.ts`, `.mjs`, `.js`, or `.json`

The built-in presentation is now fixed to the default atlas baseline. Configure metadata and navigation directly:

```json
{
  "siteUrl": "https://example.com",
  "favicon": "/favicon.svg",
  "footerNav": [
    { "label": "GitHub", "href": "https://github.com/example/repo" }
  ]
}
```

Once `siteUrl` is set, `mdorigin` also enables:

- `/sitemap.xml`
- `/feed.xml`

If you want to turn RSS off or override feed metadata, add:

```json
{
  "rss": {
    "title": "Example Feed",
    "description": "Latest updates from Example",
    "maxItems": 20
  }
}
```

Or disable it entirely:

```json
{
  "rss": false
}
```

If a page contains a managed index block, the default renderer automatically presents it as a structured listing. `mdorigin` no longer exposes built-in theme/template variants as product configuration.

If you want to start using code-based extensions now, switch from JSON config to `mdorigin.config.ts` and export a config object with `plugins`.

The stable hooks, page model, and plugin data structures are documented in [Extensions](./extensions.md).

You can still cap the first batch of article entries shown in that default listing:

```json
{
  "listingInitialPostCount": 10,
  "listingLoadMoreStep": 10
}
```

## Build directory indexes

```bash
mdorigin build index --root docs/site
```
